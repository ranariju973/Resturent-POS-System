/**
 * Dashboard and reports — Phase 10.
 *
 * ── The assertion that matters most ────────────────────────────────────────
 * This is the phase where the cashier restriction from the original brief
 * becomes a response body rather than a permission. So the central test is a
 * SOURCE-STRUCTURE one: that the limited payload is built independently rather
 * than derived from the full one by deleting fields.
 *
 * That distinction is the difference between "a cashier cannot see margin" and
 * "a cashier cannot see margin until someone adds a metric and forgets the
 * redaction list".
 */
process.env.NODE_ENV = 'development';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/verdant_pos_test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.PIN_PEPPER = 'c'.repeat(64);
process.env.INVOICE_TOKEN_PEPPER = 'v'.repeat(64);
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
process.env.LOG_LEVEL = 'error';

import fs from 'node:fs';
import path from 'node:path';
import {
  dashboardSchema,
  dailyReportSchema,
  monthlyReportSchema,
  rangeSchema,
  expenseListSchema,
  createExpenseSchema,
} from '../src/validators/reports.js';
import { dashboardScopeFor, hasPermission, PERMISSIONS } from '../src/constants/permissions.js';
import { ROLES } from '../src/constants/enums.js';

const { default: app } = await import('../app.js');

for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (err) => {
    console.error(`\n!! ${signal}: ${err?.stack ?? err}`);
    process.exit(1);
  });
}

let pass = 0;
let fail = 0;
const t = (label, cond, note = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};
const ok = (schema, input) => schema.safeParse(input).success;

const ROOT = path.resolve(import.meta.dirname, '..');
const dash = fs.readFileSync(path.join(ROOT, 'src/controllers/dashboardController.js'), 'utf8');
const dashCode = dash.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

// ---------------------------------------------------------------------------
console.log('--- the dashboard split, per role ---');
t('admin gets the full scope', dashboardScopeFor(ROLES.ADMIN) === 'full');
t('cashier gets the limited scope', dashboardScopeFor(ROLES.CASHIER) === 'limited');
t('kitchen staff get NO dashboard at all', dashboardScopeFor(ROLES.KITCHEN_STAFF) === null);
t('a cashier does not hold the full grant',
  !hasPermission(ROLES.CASHIER, PERMISSIONS.DASHBOARD_VIEW_FULL));
t('the two grants are distinct permissions, not one plus a flag',
  PERMISSIONS.DASHBOARD_VIEW_FULL !== PERMISSIONS.DASHBOARD_VIEW_LIMITED);

console.log('\n--- the limited payload is BUILT, not filtered ---');
{
  // Split the handler at the early return for the limited scope.
  const limitedStart = dashCode.indexOf("if (scope === 'limited')");
  const limitedEnd = dashCode.indexOf('const monthStart');
  const limitedBranch = dashCode.slice(limitedStart, limitedEnd);
  const fullBranch = dashCode.slice(limitedEnd);

  t('the limited branch returns early, before any admin query runs',
    limitedStart > 0 && limitedStart < limitedEnd);
  t('no field is deleted from a shared object',
    !/delete [a-z]+\./i.test(dashCode) && !/omit\(|_\.pick\(/.test(dashCode));

  // The four cards + recent orders, and nothing beyond them.
  const ALLOWED = [
    'scope', 'todaySalesMinor', 'todaySales', 'todayOrders',
    'pendingOrders', 'completedOrders', 'recentOrders',
  ];
  // Match BOTH `key: value` and ES6 shorthand `key,` — `scope` is written
  // shorthand, and counting only the colon form undercounts the payload.
  const limitedKeys = [...limitedBranch.matchAll(/^\s{6}(\w+)\s*[:,]/gm)].map((m) => m[1]);
  t(`the limited payload has exactly ${ALLOWED.length} fields`,
    limitedKeys.length === ALLOWED.length, limitedKeys.join(', '));
  t('and every one of them is on the allow-list',
    limitedKeys.every((k) => ALLOWED.includes(k)),
    limitedKeys.filter((k) => !ALLOWED.includes(k)).join(', '));

  console.log('\n--- financial fields reach the FULL branch only ---');
  const SENSITIVE = [
    'monthSales', 'monthExpenses', 'monthNet', 'marginPercent',
    'prevMonthSales', 'salesChangePercent', 'topItems',
  ];
  for (const field of SENSITIVE) {
    t(`${field} is absent from the cashier payload`, !limitedBranch.includes(`${field}:`));
  }
  t('...and present in the admin payload',
    SENSITIVE.every((f) => fullBranch.includes(`${f}:`)));
}

console.log('\n--- the endpoint accepts no parameters, so "today" cannot be widened ---');
t('an empty query is valid', ok(dashboardSchema, {}));
t('?range=month is REJECTED', !ok(dashboardSchema, { range: 'month' }));
t('?from=… is REJECTED', !ok(dashboardSchema, { from: '2020-01-01' }));
t('?scope=full is REJECTED', !ok(dashboardSchema, { scope: 'full' }));
t('the controller derives scope from the role, never the query',
  /dashboardScopeFor\(req\.user\.role\)/.test(dashCode) && !/req\.query\.scope/.test(dashCode));
t('no bare role comparison anywhere in the controller',
  !/role === ['"]admin['"]/.test(dashCode));

// ---------------------------------------------------------------------------
console.log('\n--- report date handling ---');
t('a valid day is accepted', ok(dailyReportSchema, { date: '2026-08-04' }));
t('an omitted day is fine (defaults to today)', ok(dailyReportSchema, {}));
t('2026-02-31 is rejected — it parses but is not a real date',
  !ok(dailyReportSchema, { date: '2026-02-31' }));
t('2026-13-01 rejected', !ok(dailyReportSchema, { date: '2026-13-01' }));
t('a loose date string is rejected', !ok(dailyReportSchema, { date: 'yesterday' }));
t('a valid month is accepted', ok(monthlyReportSchema, { month: '2026-08' }));
t('month 00 rejected', !ok(monthlyReportSchema, { month: '2026-00' }));
t('month 13 rejected', !ok(monthlyReportSchema, { month: '2026-13' }));

console.log('\n--- ranges are bounded ---');
t('a normal range is accepted', ok(rangeSchema, { from: '2026-01-01', to: '2026-03-01' }));
t('from after to is rejected at the schema', !ok(rangeSchema, { from: '2026-03-01', to: '2026-01-01' }));
t('unknown range param rejected', !ok(rangeSchema, { granularity: 'week' }));
{
  const rpt = fs.readFileSync(path.join(ROOT, 'src/controllers/reportController.js'), 'utf8');
  t('the SPAN is capped in the controller (schema order alone is not enough)',
    /MAX_RANGE_DAYS = 366/.test(rpt) && /must be \$\{MAX_RANGE_DAYS\} days or less/.test(rpt));
  t('an omitted range defaults to a window, not to all time',
    /new Date\(end\.getTime\(\) - 30 \* 864e5\)/.test(rpt));

  console.log('\n--- revenue excludes voids, but voids are still reported ---');
  t('every revenue match filters on status: paid', /status: ORDER_STATUS\.PAID/.test(rpt));
  t('voided orders are counted separately', /ORDER_STATUS\.VOIDED/.test(rpt));
  t('the void count is exposed to the owner', /voidedOrders: voided/.test(rpt));

  console.log('\n--- aggregation happens in MongoDB, not in Node ---');
  t('pipelines are used throughout', (rpt.match(/\.aggregate\(\[/g) ?? []).length >= 8);
  const rptCode = rpt.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  t('no full-collection fetch-then-reduce', !/await Order\.find\(\)[\s\S]{0,60}reduce/.test(rptCode));

  console.log('\n--- charts have no gaps to guess at ---');
  t('all 24 hours are present even when empty', /Array\.from\(\{ length: 24 \}/.test(rpt));
  t('every day of the month is present', /Array\.from\(\{ length: daysInMonth \}/.test(rpt));
  t('every expense category is present, including zeros',
    /EXPENSE_CATEGORY_VALUES\.map\(\(category\)/.test(rpt));

  console.log('\n--- honest nulls ---');
  t('a percentage change with no prior period is null, not 0',
    /prev\.netMinor > 0[\s\S]{0,140}: null/.test(rpt));
  t('margin with no revenue is null, not 0', /netMinor > 0 \?[\s\S]{0,80}: null/.test(rpt));
  t('the dashboard does the same', /prevMonth\.salesMinor > 0[\s\S]{0,200}: null/.test(dashCode));

  console.log('\n--- expenses ---');
  // Deletion is hard — an expense is a leaf record, nothing references it.
  // The audit snapshot is what keeps an already-read P&L explicable.
  t('deletion removes the row from MongoDB',
    /Expense\.deleteOne\(\{ _id: expense\._id \}\)/.test(rpt));
  t('the amount and category are snapshotted before the row goes',
    rpt.indexOf('const snapshot') < rpt.indexOf('Expense.deleteOne'));
  t('the audit entry carries the snapshot, not a dangling id',
    /meta: snapshot/.test(rpt));
  t('expense writes are audited', /AUDIT_ACTION\.EXPENSE_CREATE/.test(rpt));
  t('deletions are audited too', /AUDIT_ACTION\.EXPENSE_DELETE/.test(rpt));

  // --- each report owns its own payment split ------------------------------
  // The monthly tab used to render the DAILY breakdown, because the monthly
  // endpoint had none to give it. That showed one day's takings under a
  // monthly heading whenever it showed anything at all.
  console.log('\n--- payment breakdowns ---');
  const dailyBody = rpt.slice(rpt.indexOf('export const dailyReport'), rpt.indexOf('export const monthlyReport'));
  const monthlyBody = rpt.slice(rpt.indexOf('export const monthlyReport'), rpt.indexOf('export const profitAndLoss'));

  t('the daily report groups by payment method',
    /_id: '\$paymentMethod'/.test(dailyBody));
  t('the monthly report groups by payment method too',
    /_id: '\$paymentMethod'/.test(monthlyBody));
  t('and returns it under the same key as daily, so one component renders both',
    /byPaymentMethod:/.test(monthlyBody));
  t('the monthly split covers the month, not a day',
    /_id: '\$paymentMethod'[\s\S]{0,200}/.test(monthlyBody) &&
      monthlyBody.includes('paidBetween(start, end)'));
  t('an unrecorded method is labelled rather than dropped',
    /'unrecorded'/.test(monthlyBody));
}

console.log('\n--- expense input ---');
const validExpense = { date: '2026-08-01', category: 'Ingredients', description: 'Weekly market run', amount: '1840.50' };
t('a valid expense is accepted', ok(createExpenseSchema, validExpense));
t('amount converts to minor units',
  createExpenseSchema.parse(validExpense).amountMinor === 184050,
  String(createExpenseSchema.parse(validExpense).amountMinor));
t('the ambiguous `amount` key is gone after parsing',
  !('amount' in createExpenseSchema.parse(validExpense)));
t('three decimals rejected', !ok(createExpenseSchema, { ...validExpense, amount: '1.005' }));
t('zero rejected', !ok(createExpenseSchema, { ...validExpense, amount: 0 }));
t('negative rejected', !ok(createExpenseSchema, { ...validExpense, amount: -100 }));
t('an unknown category rejected', !ok(createExpenseSchema, { ...validExpense, category: 'Bribes' }));
t('createdBy cannot be forged',
  !ok(createExpenseSchema, { ...validExpense, createdBy: '507f1f77bcf86cd799439011' }));
t('amountMinor cannot be supplied directly',
  !ok(createExpenseSchema, { ...validExpense, amountMinor: 1 }));
t('expense list limit is capped', !ok(expenseListSchema, { limit: 500 }));
t('expense list defaults to 100', expenseListSchema.parse({}).limit === 100);

// ---------------------------------------------------------------------------
console.log('\n--- auth wall (live HTTP) ---');
const ROUTES = [
  ['GET', '/api/dashboard'],
  ['GET', '/api/reports/daily'],
  ['GET', '/api/reports/monthly'],
  ['GET', '/api/reports/pnl'],
  ['GET', '/api/reports/expenses'],
  ['POST', '/api/reports/expenses'],
  ['DELETE', '/api/reports/expenses/507f1f77bcf86cd799439011'],
];

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  let unauthorised = 0;
  for (const [method, url] of ROUTES) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    if (res.status === 401) unauthorised += 1;
    else console.log(`     ${method} ${url} -> ${res.status} (expected 401)`);
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller`, unauthorised === ROUTES.length,
    `${unauthorised}/${ROUTES.length}`);

  const forged = await fetch(`${base}/api/reports/pnl`, {
    headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.' },
  });
  t('an alg:none token claiming admin cannot read the P&L', forged.status === 401);
} finally {
  await new Promise((r) => server.close(r));
}

console.log('\n--- route wiring ---');
const dashRoutes = fs.readFileSync(path.join(ROOT, 'src/routes/dashboard.js'), 'utf8');
const rptRoutes = fs.readFileSync(path.join(ROOT, 'src/routes/reports.js'), 'utf8');

t('the dashboard accepts either grant', /requireAnyPermission/.test(dashRoutes));
t('the dashboard validates its (empty) query', /validate\(\{ query: dashboardSchema \}\)/.test(dashRoutes));
t('EVERY report route is gated once, router-wide',
  /router\.use\(requirePermission\(PERMISSIONS\.REPORTS_VIEW\)\)/.test(rptRoutes));
t('reports sit behind requireAuth as well', /router\.use\(requireAuth\(\)\)/.test(rptRoutes));
t('a cashier holds no reports:view, so all six 403',
  !hasPermission(ROLES.CASHIER, PERMISSIONS.REPORTS_VIEW));
t('kitchen staff likewise', !hasPermission(ROLES.KITCHEN_STAFF, PERMISSIONS.REPORTS_VIEW));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
