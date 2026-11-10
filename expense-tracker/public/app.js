const categories = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = id => document.getElementById(id);
const form = $('expense-form');
const filterForm = $('filter-form');
let editingId = null;
let busy = false;
let filters = new URLSearchParams();
let loadVersion = 0;
let visibleExpenses = [];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function message(element, text, error = false) {
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle('error', error);
}

async function request(url, options = {}) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('Cannot reach the server. Check that it is running, then try again.'); }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'The request failed. Please try again.'), { fields: data.error?.fields });
  return data;
}

function clearErrors() {
  for (const name of ['title', 'amount', 'category', 'date', 'note']) {
    $(`${name}-error`).textContent = '';
    $(name).removeAttribute('aria-invalid');
  }
  message($('form-error'), '');
}

function showFields(fields) {
  for (const [name, error] of Object.entries(fields)) {
    if (!$(`${name}-error`)) continue;
    $(`${name}-error`).textContent = error;
    $(name).setAttribute('aria-invalid', 'true');
  }
  const first = Object.keys(fields)[0];
  if ($(first)) $(first).focus();
}

function resetForm() {
  editingId = null;
  form.reset();
  $('date').value = today();
  $('form-heading').textContent = 'Add an expense';
  $('save-button').textContent = 'Add Expense';
  $('cancel-button').hidden = true;
  clearErrors();
}

function setBusy(value) {
  busy = value;
  form.setAttribute('aria-busy', String(value));
  for (const element of form.elements) element.disabled = value;
  for (const button of $('expense-list').querySelectorAll('button')) button.disabled = value;
  $('save-button').textContent = value ? 'Saving…' : editingId ? 'Save Changes' : 'Add Expense';
}

function renderSummary(summary) {
  $('month-label').textContent = new Date(`${summary.month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  $('month-total').textContent = money.format(summary.total);
  $('category-summary').replaceChildren();
  for (const category of categories) {
    const item = document.createElement('div');
    item.className = 'category-item';
    const label = document.createElement('p');
    const dot = document.createElement('span');
    dot.className = `dot ${category.toLowerCase()}`;
    dot.setAttribute('aria-hidden', 'true');
    label.append(dot, document.createTextNode(category));
    const amount = document.createElement('strong');
    amount.textContent = money.format(summary.categories[category]);
    item.append(label, amount);
    $('category-summary').append(item);
  }
}

function renderExpenses(records, totalCount) {
  visibleExpenses = records;
  const list = $('expense-list');
  list.replaceChildren();
  $('expense-count').textContent = String(records.length);
  $('list-state').hidden = records.length > 0;
  $('list-state').textContent = totalCount === 0 ? 'No expenses yet.\nAdd your first expense to start tracking.' : 'No expenses match these filters.\nTry another search or clear your filters.';
  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'expense-card';
    // Only static markup goes through innerHTML. User text always uses textContent.
    card.innerHTML = '<div class="expense-top"><h3 class="expense-title"></h3><span class="expense-amount"></span></div><p class="expense-meta"><span class="category-badge"></span><time></time></p><p class="expense-note"></p><div class="expense-actions"><button class="text-button edit" type="button">Edit</button><button class="text-button delete" type="button">Delete</button></div>';
    card.querySelector('.expense-title').textContent = record.title;
    card.querySelector('.expense-amount').textContent = money.format(record.amount);
    card.querySelector('.category-badge').textContent = record.category;
    const time = card.querySelector('time');
    time.dateTime = record.date;
    time.textContent = new Date(`${record.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    card.querySelector('.expense-note').textContent = record.note || 'No note';
    const edit = card.querySelector('.edit');
    const remove = card.querySelector('.delete');
    edit.setAttribute('aria-label', `Edit ${record.title}`);
    remove.setAttribute('aria-label', `Delete ${record.title}`);
    edit.disabled = remove.disabled = busy;
    edit.addEventListener('click', () => editExpense(record.id));
    remove.addEventListener('click', () => deleteExpense(record));
    list.append(card);
  }
}

async function refresh() {
  const version = ++loadVersion;
  $('expense-list').setAttribute('aria-busy', 'true');
  $('summary').setAttribute('aria-busy', 'true');
  $('list-state').hidden = false;
  $('list-state').textContent = 'Loading expenses…';
  $('expense-list').hidden = true;
  try {
    const [records, summary, all] = await Promise.all([
      request(`/api/expenses?${filters}`), request('/api/summary'), request('/api/expenses')
    ]);
    if (version !== loadVersion) return false;
    renderExpenses(records, all.length);
    renderSummary(summary);
    $('expense-list').hidden = false;
    return true;
  } catch (error) {
    if (version !== loadVersion) return false;
    $('list-state').textContent = 'Unable to load expenses. Use Refresh to try again.';
    $('expense-count').textContent = '';
    $('month-total').textContent = 'Unavailable';
    $('category-summary').replaceChildren();
    message($('status'), error.message, true);
    return false;
  } finally {
    if (version === loadVersion) {
      $('expense-list').setAttribute('aria-busy', 'false');
      $('summary').setAttribute('aria-busy', 'false');
    }
  }
}

function editExpense(id) {
  if (busy) return;
  const record = visibleExpenses.find(expense => expense.id === id);
  if (!record) return;
  clearErrors();
  editingId = id;
  for (const name of ['title', 'amount', 'category', 'date', 'note']) $(name).value = record[name];
  $('form-heading').textContent = 'Edit expense';
  $('save-button').textContent = 'Save Changes';
  $('cancel-button').hidden = false;
  form.scrollIntoView({ behavior: 'auto', block: 'center' });
  $('title').focus({ preventScroll: true });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  clearErrors();
  message($('status'), '');
  const payload = { title: $('title').value.trim(), amount: $('amount').valueAsNumber, category: $('category').value, date: $('date').value, note: $('note').value.trim() };
  const fields = {};
  if (!payload.title) fields.title = 'Enter a title.';
  if (!Number.isFinite(payload.amount) || payload.amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(payload.amount)) || !Number.isSafeInteger(Math.round(payload.amount * 100))) fields.amount = 'Enter a positive amount with at most two decimal places, within the safe numeric range.';
  if (!categories.includes(payload.category)) fields.category = 'Choose a category.';
  if (!payload.date || !$('date').validity.valid) fields.date = 'Enter a valid calendar date.';
  if (Object.keys(fields).length) { showFields(fields); return; }
  const wasEditing = Boolean(editingId);
  setBusy(true);
  try {
    await request(wasEditing ? `/api/expenses/${encodeURIComponent(editingId)}` : '/api/expenses', { method: wasEditing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    resetForm();
    message($('status'), wasEditing ? 'Expense updated.' : 'Expense added.');
    await refresh();
  } catch (error) {
    message($('form-error'), error.message, true);
    if (error.fields) showFields(error.fields);
  } finally { setBusy(false); }
});

async function deleteExpense(record) {
  if (busy || !window.confirm(`Delete “${record.title}” (${money.format(record.amount)})? This cannot be undone.`)) return;
  setBusy(true);
  message($('status'), 'Deleting expense…');
  try {
    await request(`/api/expenses/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
    if (editingId === record.id) resetForm();
    message($('status'), 'Expense deleted.');
    await refresh();
  } catch (error) { message($('status'), error.message, true); }
  finally { setBusy(false); }
}

filterForm.addEventListener('submit', event => {
  event.preventDefault();
  const from = $('filter-from');
  const to = $('filter-to');
  if (!from.validity.valid || !to.validity.valid || (from.value && to.value && from.value > to.value)) {
    message($('filter-error'), 'Enter valid dates. From date must be on or before To date.', true);
    return;
  }
  message($('filter-error'), '');
  message($('status'), '');
  filters = new URLSearchParams();
  for (const [name, value] of new FormData(filterForm)) if (value) filters.set(name, value);
  refresh();
});
$('clear-filters').addEventListener('click', () => {
  filterForm.reset();
  filters = new URLSearchParams();
  message($('filter-error'), '');
  message($('status'), '');
  refresh();
});
$('cancel-button').addEventListener('click', resetForm);
$('retry-button').addEventListener('click', () => { message($('status'), ''); refresh(); });
resetForm();
refresh();
