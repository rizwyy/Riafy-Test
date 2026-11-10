const CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Bills",
  "Entertainment",
  "Other",
];

function badRequest(message, fields) {
  return Object.assign(new Error(message), { status: 400, fields });
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function amountToPaise(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    return null;
  // Parse decimal digits rather than using floating-point addition or rounding.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!match) return null;
  const paise =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function validateExpense(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw badRequest("Send an expense as a JSON object.");
  const fields = {};
  if (typeof body.title !== "string" || !body.title.trim())
    fields.title = "Enter a title.";
  const amountPaise = amountToPaise(body.amount);
  if (amountPaise === null)
    fields.amount =
      "Enter a positive amount with at most two decimal places, within the safe numeric range.";
  if (!CATEGORIES.includes(body.category))
    fields.category = "Choose one of the six categories.";
  if (!validDate(body.date))
    fields.date = "Enter a valid calendar date in YYYY-MM-DD format.";
  if (body.note !== undefined && typeof body.note !== "string")
    fields.note = "Note must be text.";
  if (Object.keys(fields).length)
    throw badRequest("Please correct the highlighted fields.", fields);
  return {
    title: body.title.trim(),
    amountPaise,
    category: body.category,
    date: body.date,
    note: (body.note || "").trim(),
  };
}

function validateFilters(query) {
  const filters = {};
  for (const name of ["category", "from", "to", "title"]) {
    if (query[name] !== undefined && typeof query[name] !== "string")
      throw badRequest(`The ${name} filter must be a single value.`);
    filters[name] = query[name] || "";
  }
  if (filters.category && !CATEGORIES.includes(filters.category))
    throw badRequest("Choose a valid category filter.");
  for (const name of ["from", "to"]) {
    if (filters[name] && !validDate(filters[name]))
      throw badRequest(`Enter a valid ${name} date in YYYY-MM-DD format.`);
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw badRequest("From date must be on or before To date.");
  return filters;
}

module.exports = {
  CATEGORIES,
  badRequest,
  validDate,
  validateExpense,
  validateFilters,
};
