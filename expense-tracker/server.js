const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ExpenseStore } = require('./store');
const { CATEGORIES, validateExpense, validateFilters } = require('./validation');

function publicExpense({ amountPaise, ...record }) {
  return { ...record, amount: amountPaise / 100 };
}

function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/expenses', (req, res) => {
    const filters = validateFilters(req.query);
    const records = store.all().filter(record =>
      (!filters.category || record.category === filters.category)
      && (!filters.from || record.date >= filters.from)
      && (!filters.to || record.date <= filters.to)
      && (!filters.title || record.title.toLowerCase().includes(filters.title.toLowerCase())));
    records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    res.json(records.map(publicExpense));
  });

  app.post('/api/expenses', async (req, res) => {
    const data = validateExpense(req.body);
    const record = { id: randomUUID(), ...data };
    await store.mutate(records => { records.push(record); });
    res.status(201).json(publicExpense(record));
  });

  app.put('/api/expenses/:id', async (req, res) => {
    const data = validateExpense(req.body);
    const result = await store.mutate(records => {
      const index = records.findIndex(record => record.id === req.params.id);
      if (index === -1) throw Object.assign(new Error('Expense not found.'), { status: 404 });
      records[index] = { id: records[index].id, ...data };
      return records[index];
    });
    res.json(publicExpense(result));
  });

  app.delete('/api/expenses/:id', async (req, res) => {
    await store.mutate(records => {
      const index = records.findIndex(record => record.id === req.params.id);
      if (index === -1) throw Object.assign(new Error('Expense not found.'), { status: 404 });
      records.splice(index, 1);
    });
    res.json({ success: true });
  });

  app.get('/api/summary', (req, res) => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const categoryPaise = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
    let totalPaise = 0;
    for (const record of store.all()) {
      if (record.date.startsWith(month + '-')) {
        totalPaise += record.amountPaise;
        categoryPaise[record.category] += record.amountPaise;
      }
    }
    res.json({ month, total: totalPaise / 100, categories: Object.fromEntries(CATEGORIES.map(category => [category, categoryPaise[category] / 100])) });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: { message: 'API endpoint not found.' } }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((req, res) => res.status(404).json({ error: { message: 'Page not found.' } }));
  app.use((error, req, res, next) => {
    const invalidBody = ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported', 'charset.unsupported'].includes(error.type);
    const status = invalidBody ? 400 : ([400, 404].includes(error.status) ? error.status : 500);
    if (status === 500) console.error('Expense request failed:', error);
    const message = invalidBody ? 'Send valid JSON with a request body smaller than 100 KB.'
      : status === 500 ? 'Could not access or save expense data. Please try again; check the server log if this continues.' : error.message;
    res.status(status).json({ error: { message, ...(error.fields ? { fields: error.fields } : {}) } });
  });
  return app;
}

async function start() {
  // The override is useful for isolated verification, without touching personal data.
  const file = process.env.EXPENSE_DATA_FILE
    ? path.resolve(__dirname, process.env.EXPENSE_DATA_FILE)
    : path.join(__dirname, 'data', 'expenses.json');
  const store = new ExpenseStore(file);
  await store.init();
  const port = process.env.PORT || 3000;
  const server = createApp(store).listen(port, () => console.log(`Expense tracker: http://localhost:${server.address().port}\nData: ${file}`));
  server.on('error', error => { console.error('Could not start expense tracker:', error.message); process.exitCode = 1; });
}

if (require.main === module) start().catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });
module.exports = { createApp };
