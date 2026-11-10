# Personal expense tracker

A single-user, local INR expense tracker for the Riafy practical exercise. Plain HTML/CSS/JavaScript, Express, and a server-side JSON file. No frontend build step.

## Install and run

Prerequisites: **Node.js 22 or newer** and npm. From this source folder:

```sh
cd /Users/rizwin/Desktop/Riafy-Test/expense-tracker
npm install
npm start
```

Open **http://localhost:3000**. Express serves both the UI and API. Stop with Ctrl+C.

If port 3000 is occupied, use another port (macOS/Linux):

```sh
PORT=3107 npm start
```

Then open **http://localhost:3107**. Windows PowerShell: `$env:PORT=3107; npm start`. Do not run multiple processes against the same data file. The documented `npm start` command was exercised; port 3000 was occupied in the verification environment, so the working instance was started using `PORT=3107 npm start`.

## Structure and decisions

```text
server.js           Express routes, summary, static files, error handling
validation.js       Calendar dates, expense validation, filter validation
store.js            Dataset validation, serialized mutations, atomic replacement
public/index.html   Labelled forms, summary, history
public/app.js       Fetch requests, form state, safe DOM rendering
public/styles.css   Responsive layout using locally bundled Inter
public/fonts/       Inter font and its OFL license
data/expenses.json  Created automatically on first run; ignored by Git
scripts/verify.js   Repeatable HTTP/persistence checks using temporary data
```

Express is the only direct runtime dependency. It keeps routing and JSON handling readable. Serving everything from one origin avoids a second server, build pipeline, and CORS configuration. The font is bundled locally; no external service is used at runtime.

### Data model

The file contains an array of records:

```json
[
  {
    "id": "server-generated-UUID",
    "title": "Lunch",
    "amountPaise": 12345,
    "category": "Food",
    "date": "2026-11-10",
    "note": "With friends"
  }
]
```

The API exposes `amount: 123.45` instead of `amountPaise`. Amounts in requests must be JSON numbers, finite, positive, and have at most two decimal places. More precision is rejected rather than silently rounded. Decimal digits are converted to integer paise before storage and addition, preventing errors such as `0.1 + 0.2`. Individual paise values and the combined dataset total must fit JavaScript's safe integer range. Currency is displayed with exactly two decimal places using `Intl.NumberFormat`.

Titles and notes are trimmed; an omitted note becomes `""`. Categories are exactly Food, Transport, Shopping, Bills, Entertainment, Other. Dates must be real calendar dates from `0001-01-01` through `9999-12-31` in `YYYY-MM-DD` format. Future dates are allowed. The form defaults to today's **browser-local** date. The summary uses the **server's local calendar month**, recalculated on each summary request. These normally agree when the app runs locally; they can differ if the browser and server use different timezones. The sample date above describes the schema; no assessment date is hard-coded into app logic.

Expenses sort by descending date, then ascending ID for a stable tie-breaker. IDs do not change on edit. User text is assigned with `textContent`, so HTML-like titles and notes display literally.

### Persistence

The default file is resolved relative to `server.js`, independently of the terminal's working directory. A missing file is initialized to `[]`. Invalid JSON, invalid records, and duplicate IDs prevent startup with a diagnostic message; existing data is never silently reset. To recover, stop the app, back up the original, and correct the file or deliberately move it aside before restarting.

Each create/edit/delete enters a promise queue, copies the latest committed records, writes a uniquely named temporary file in the same directory, and renames it over the data file. Only then is the in-memory dataset replaced and an HTTP success returned. Failed writes leave the in-memory records unchanged and do not block later writes. The temporary replacement avoids readers seeing a half-written JSON document. Errors are logged on the server and returned as a useful, non-diagnostic message to the client.

`EXPENSE_DATA_FILE` optionally selects a separate data file for verification; relative values are resolved against the app directory. Normal use does not need it.

## API

All successful record responses use rupees. Errors consistently use:

```json
{
  "error": {
    "message": "Please correct the highlighted fields.",
    "fields": { "title": "Enter a title." }
  }
}
```

The optional `fields` object is present for expense field validation. Status codes: **400** invalid input/JSON/filters, **404** missing expense or endpoint, **500** unexpected storage/server failure. JSON request bodies are limited to 100 KB; oversized bodies return 400.

| Method | Endpoint            | Result                                              |
| ------ | ------------------- | --------------------------------------------------- |
| POST   | `/api/expenses`     | 201, created record                                 |
| GET    | `/api/expenses`     | 200, sorted array                                   |
| PUT    | `/api/expenses/:id` | 200, updated record; sends the full expense fields  |
| DELETE | `/api/expenses/:id` | 200, `{"success":true}`                             |
| GET    | `/api/summary`      | 200, current month, total, all six category amounts |

POST/PUT example:

```sh
curl -i http://localhost:3107/api/expenses \
  -H 'Content-Type: application/json' \
  -d '{"title":"Lunch","amount":125.50,"category":"Food","date":"2026-11-10","note":"With friends"}'
```

GET filters are optional and combine with AND: `category` (exact), `title` (case-insensitive partial match), `from` and `to` (inclusive). Empty values mean no restriction. Repeated recognized parameters and invalid calendar dates are rejected. Reversed date boundaries return 400. Examples:

```text
/api/expenses?category=Food
/api/expenses?title=LUNCH&from=2026-11-01&to=2026-11-30
/api/expenses?title=unlikely-to-match
/api/expenses?from=2026-11-30&to=2026-11-01   (400)
```

The summary ignores list filters:

```json
{
  "month": "2026-11",
  "total": 125.5,
  "categories": {
    "Food": 125.5,
    "Transport": 0,
    "Shopping": 0,
    "Bills": 0,
    "Entertainment": 0,
    "Other": 0
  }
}
```

## Completed scope

- Add, list, edit with the same ID, cancel editing, and confirmed delete.
- Client and server validation; field errors preserve form input.
- All user-entered fields displayed; multiline notes wrap safely.
- INR formatting, local default date, stable sorting, future dates accepted.
- Current-month total and all category totals independent of filters.
- Category, title, either date boundary, combined AND filters, Clear Filters, reversed-range errors.
- Distinct empty dataset and no-match states.
- Visible load/save/error states, disabled controls during mutations, Refresh for retry.
- JSON persistence across refresh/restart with serialized atomic replacement and corruption protection.
- Responsive CSS, labelled controls, keyboard focus styles, live status messages, locally bundled Inter.

No required feature was intentionally skipped. Actual browser verification remains outstanding because the available browser automation host could not be reached. Authentication, multi-user support, charts, deployment, and external integrations were omitted as requested.

## Verification performed

```sh
npm run verify
```

**50 checks passed** against a real HTTP server, with a fresh temporary directory and dataset. The script starts the server from a different working directory, shuts it down, starts it again, and cleans up only its own temporary directory. It never opens the normal personal data file. Checks cover:

- Empty list, runtime month, zero total and six zero categories; frontend and local font served.
- Creation, trimmed strings, note default, rupee response, integer paise written before success.
- Blank titles, missing/invalid categories, zero/negative/nonnumeric/null/unsafe amounts, extra decimal places, invalid dates/leap days, invalid notes, malformed JSON.
- Descending dates and consistent ID tie-breaker; future dates accepted.
- Exact decimal totals, category totals, excluding other months.
- Category/title/date filters individually and together; both inclusive boundaries; either boundary omitted; no matches; reversed ranges and invalid filters.
- Summary unchanged by list filters.
- Editing retains ID and updates totals/categories; invalid edit rejected.
- Deletion updates totals; missing IDs return 404.
- Concurrent writes keep all records; actual process restart preserves content and sort order.
- Simulated storage failure returns 500, leaves committed memory unchanged, and permits recovery.
- Corruption prevents startup and leaves the original bytes untouched.

Also performed: JavaScript syntax checks, dependency installation, and real `npm start` startup (using the documented port override because 3000 was occupied).

**Not performed:** rendered browser inspection, browser form interactions, browser refresh, keyboard walkthrough, and narrow-screen visual QA. The browser-control tool returned “The browser access host is unavailable.” Serving HTML and passing API checks do not establish those UI behaviors.

### Manual browser acceptance pass

Use disposable records and delete only those records afterward:

1. Open the app with a fresh dataset. Confirm “No expenses yet”, ₹0.00 total, and six zero category amounts. Check that Inter loads.
2. Add an expense dated this month with a multiline note. Confirm every field, INR formatting, today's initial local date, cleared form, and updated summary.
3. Submit a whitespace title, omit category, and try zero, negative, nonnumeric amount, extra precision, or missing/invalid date. Confirm helpful errors preserve input. The browser may itself prevent typing invalid number/date values.
4. Add a second expense with a later date, plus one outside the current month. Confirm order and that the out-of-month amount is excluded from the summary.
5. Edit an expense; check prefilled values, Save Changes, Cancel, stable ID, list refresh, and updated category/total. Cancel an edit without saving.
6. Apply category, mixed-case partial title, each date boundary, exact same-day boundaries, and combined filters. Confirm AND logic and unchanged summary. Try a reversed date range, a no-match search, and Clear Filters.
7. With a filter active, edit a matching expense so it no longer matches; confirm it disappears but the filter remains. Delete another matching expense; cancel the first confirmation, then confirm deletion and verify totals.
8. Add `<img src=x onerror="alert(1)">` as a title. Confirm it is displayed literally and no script runs.
9. Reload the page and restart the server. Confirm saved records remain. Filters reset on browser reload by design.
10. Check at desktop and approximately 375 px width: labels, notes, focus outlines, and actions remain usable. Stop the server and use Refresh; confirm a visible connection error, then restart and retry.

## Limitations and trade-offs

- One local user and **one server process per data file**. No authentication, locking across processes, database, or deployment hardening. Use only in a trusted local environment.
- Every mutation rewrites the whole file; reads use an in-memory snapshot. This is appropriate for a small personal dataset. External file edits require a restart. It is not designed for large datasets or multiple servers.
- Atomic rename protects against partial files during normal operation. There is no explicit disk `fsync`, power-loss durability guarantee, automatic backup, or recovery UI. A process crash can leave an unused `.tmp` file; startup uses the main JSON file.
- The UI refreshes on load, mutations, filters, and Refresh. It does not poll, synchronize other tabs, or automatically refresh at midnight. Use Refresh after a month boundary.
- A connection loss after the server commits but before the response arrives can leave the client unsure whether a mutation succeeded. Refresh before retrying an uncertain save; request idempotency is outside this exercise.
- Very large JSON-number amounts are constrained by JavaScript numeric representation. The app rejects unsafe integer-paise values/totals; this is a personal expense tracker, not a financial ledger for arbitrary-sized values.

## Explain it to the evaluator

“The browser sends expense data as JSON to Express on the same origin. Both layers validate input, and the server is authoritative. The server creates a UUID and converts rupees to integer paise. A queued mutation writes a temporary JSON file and replaces the main file before returning success. The browser then reloads the filtered list and the separate, unfiltered monthly summary. Edits keep the UUID, and all user text is rendered as text. This is deliberately a small, single-process local app; a database and authentication would be the next choices only if the scope required them.”
