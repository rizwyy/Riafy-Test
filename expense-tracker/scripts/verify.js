// Real HTTP checks against a child server and an isolated temporary dataset.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-tracker-verify-'));
  const file = path.join(directory, 'expenses.json');
  let child;
  let base;
  let passed = 0;
  function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
  async function start() {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      cwd: directory, env: { ...process.env, PORT: '0', EXPENSE_DATA_FILE: file }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stderr.on('data', chunk => { log += chunk; });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Server startup timeout: ${log}`)); }, 10000);
      child.stdout.on('data', chunk => {
        log += chunk;
        const match = /http:\/\/localhost:(\d+)/.exec(log);
        if (match) { clearTimeout(timer); resolve(`http://localhost:${match[1]}`); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${log}`)); });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
  }
  async function api(route, method = 'GET', body) {
    const response = await fetch(base + route, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const input = { title: '  Verification lunch  ', amount: 12.34, category: 'Food', date: `${month}-10`, note: '  Shared meal\nSecond line  ' };
  try {
    await start();
    const home = await fetch(base);
    check('Frontend served by Express', () => assert.equal(home.status, 200));
    const font = await fetch(base + '/fonts/InterVariable.woff2');
    check('Bundled Inter font is served', () => assert.equal(font.status, 200));
    let result = await api('/api/expenses');
    check('Empty dataset initializes', () => assert.deepEqual(result.data, []));
    result = await api('/api/summary');
    check('Runtime month and all six zero categories', () => {
      assert.equal(result.data.month, month); assert.equal(result.data.total, 0);
      assert.deepEqual(result.data.categories, { Food: 0, Transport: 0, Shopping: 0, Bills: 0, Entertainment: 0, Other: 0 });
    });
    const invalid = [
      ['blank title', { title: '   ' }], ['missing category', { category: undefined }],
      ['zero amount', { amount: 0 }], ['negative amount', { amount: -1 }],
      ['nonnumeric amount', { amount: 'abc' }], ['numeric string', { amount: '12.34' }],
      ['null amount', { amount: null }], ['extra precision', { amount: 1.234 }],
      ['unsafe amount', { amount: 1e20 }], ['invalid date', { date: '2026-02-30' }],
      ['invalid leap day', { date: '2025-02-29' }], ['invalid category', { category: 'food' }],
      ['invalid note', { note: 123 }], ['nonpadded date', { date: '2026-1-01' }]
    ];
    for (const [label, overrides] of invalid) {
      result = await api('/api/expenses', 'POST', { ...input, ...overrides });
      check(`Rejects ${label}`, () => { assert.equal(result.status, 400); assert.ok(result.data.error.message); });
    }
    const malformed = await fetch(base + '/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
    check('Malformed JSON returns JSON 400', () => { assert.equal(malformed.status, 400); assert.match(malformed.headers.get('content-type'), /json/); });
    result = await api('/api/expenses', 'POST', input);
    const first = result.data;
    check('Create returns 201, UUID, trimmed title and note', () => { assert.equal(result.status, 201); assert.ok(first.id); assert.equal(first.title, 'Verification lunch'); assert.equal(first.note, 'Shared meal\nSecond line'); assert.equal(first.amount, 12.34); });
    const disk = JSON.parse(await fs.readFile(file, 'utf8'));
    check('Persisted before success as integer paise', () => { assert.equal(disk[0].amountPaise, 1234); assert.equal(disk[0].amount, undefined); });
    const second = (await api('/api/expenses', 'POST', { ...input, title: 'Bus ticket', amount: 0.1, category: 'Transport', date: `${month}-11`, note: undefined })).data;
    const third = (await api('/api/expenses', 'POST', { ...input, title: 'VERIFICATION coffee', amount: 0.2, date: `${month}-10` })).data;
    const old = (await api('/api/expenses', 'POST', { ...input, title: 'Past purchase', amount: 99, date: '2000-01-01' })).data;
    const future = (await api('/api/expenses', 'POST', { ...input, title: 'Future purchase', amount: 88, date: '9999-12-31' })).data;
    check('Optional note defaults empty; future dates accepted', () => { assert.equal(second.note, ''); assert.ok(future.id); });
    result = await api('/api/expenses');
    check('Dates descending with stable ID tie-breaker', () => assert.deepEqual(result.data.map(r => r.id), [future.id, second.id, ...[first.id, third.id].sort(), old.id]));
    const summary = (await api('/api/summary')).data;
    check('Exact decimal total; excludes other months', () => { assert.equal(summary.total, 12.64); assert.equal(summary.categories.Food, 12.54); assert.equal(summary.categories.Transport, 0.1); });
    for (const [label, query, expected] of [
      ['category', 'category=Transport', [second.id]],
      ['case-insensitive title', 'title=vErIfIcAtIoN', [first.id, third.id]],
      ['inclusive from', `from=${month}-11&to=${month}-11`, [second.id]],
      ['from only', 'from=9999-12-31', [future.id]],
      ['to only', 'to=2000-01-01', [old.id]],
      ['combined AND', `category=Food&title=COFFEE&from=${month}-10&to=${month}-10`, [third.id]],
      ['no match', 'title=does-not-exist', []]
    ]) {
      result = await api('/api/expenses?' + query);
      check(`Filter: ${label}`, () => { assert.equal(result.status, 200); assert.deepEqual(result.data.map(r => r.id).sort(), expected.sort()); });
    }
    result = await api('/api/summary');
    check('Filters do not alter summary', () => assert.deepEqual(result.data, summary));
    for (const query of ['from=2026-02-02&to=2026-02-01', 'from=2026-02-30', 'category=invalid', 'title=a&title=b']) {
      result = await api('/api/expenses?' + query);
      check(`Invalid filter: ${query}`, () => assert.equal(result.status, 400));
    }
    const edited = { ...input, title: '<img src=x onerror="window.hacked=true">', amount: 20.5, category: 'Bills' };
    result = await api('/api/expenses/' + first.id, 'PUT', edited);
    check('Edit retains ID and literal HTML-like title', () => { assert.equal(result.status, 200); assert.equal(result.data.id, first.id); assert.equal(result.data.title, edited.title); });
    result = await api('/api/summary');
    check('Edit updates total and categories', () => { assert.equal(result.data.total, 20.8); assert.equal(result.data.categories.Bills, 20.5); assert.equal(result.data.categories.Food, 0.2); });
    result = await api('/api/expenses/' + first.id, 'PUT', { ...input, amount: -3 });
    check('Invalid edit rejected', () => assert.equal(result.status, 400));
    result = await api('/api/expenses/' + second.id, 'DELETE');
    check('Delete returns consistent success JSON', () => { assert.equal(result.status, 200); assert.deepEqual(result.data, { success: true }); });
    result = await api('/api/summary');
    check('Delete updates summary', () => assert.equal(result.data.total, 20.7));
    for (const method of ['PUT', 'DELETE']) {
      result = await api('/api/expenses/unknown-id', method, method === 'PUT' ? input : undefined);
      check(`Unknown ID ${method} returns 404`, () => assert.equal(result.status, 404));
    }
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, i) => api('/api/expenses', 'POST', { ...input, title: `Concurrent ${i}`, amount: 0.01 })));
    result = await api('/api/expenses');
    check('Concurrent writes preserve every record', () => { assert.ok(concurrent.every(r => r.status === 201)); assert.equal(result.data.length, 16); });
    const beforeRestart = result.data;
    await stop();
    await start();
    result = await api('/api/expenses');
    check('Actual server restart preserves records and ordering', () => assert.deepEqual(result.data, beforeRestart));

    // Induce a failed rename only inside this temporary verification directory.
    const saved = await fs.readFile(file, 'utf8');
    await fs.unlink(file);
    await fs.mkdir(file);
    result = await api('/api/expenses', 'POST', input);
    check('Storage failure returns 500 without reporting success', () => { assert.equal(result.status, 500); assert.match(result.data.error.message, /save expense data/); });
    result = await api('/api/expenses');
    check('Failed write does not alter in-memory data', () => assert.deepEqual(result.data, beforeRestart));
    await fs.rmdir(file);
    await fs.writeFile(file, saved);
    result = await api('/api/expenses', 'POST', input);
    check('Write queue recovers after storage failure', () => assert.equal(result.status, 201));
    await stop();
    await fs.writeFile(file, '{corrupted');
    let corruptionError;
    try { await start(); } catch (error) { corruptionError = error; }
    check('Corruption prevents startup and explains preserved data', () => { assert.ok(corruptionError); assert.match(corruptionError.message, /Existing data has not been overwritten/); });
    check('Corrupt original remains untouched', () => assert.equal(require('node:fs').readFileSync(file, 'utf8'), '{corrupted'));
    console.log(`\n${passed} checks passed. Temporary verification data only; personal data untouched.`);
  } finally {
    await stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
