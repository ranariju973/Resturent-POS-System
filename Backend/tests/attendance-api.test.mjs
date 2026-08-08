/**
 * Attendance — the payroll input.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB, so nothing is marked for real. What runs: the schemas, and the
 * auth wall over live HTTP. The rest is a source audit of the two properties
 * that make this collection trustworthy as a wage input — that a day is
 * written idempotently, and that a day means a day regardless of what time the
 * admin clicked save.
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
  attendanceMonthSchema,
  attendanceDaySchema,
  markDaySchema,
  updateAttendanceSchema,
} from '../src/validators/attendance.js';
import {
  payrollMonthSchema,
  adjustPayrollSchema,
  payrollKeyParamsSchema,
} from '../src/validators/payroll.js';

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
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const model = strip(read('src/models/Attendance.js'));
const ctl = strip(read('src/controllers/attendanceController.js'));
const routeSrc = strip(read('src/routes/attendance.js'));
const payrollRouteSrc = strip(read('src/routes/payroll.js'));

const ID = '507f1f77bcf86cd799439011';
const ENTRY = { employee: ID, status: 'present' };

console.log('--- dates must be real days ---');
t('a well-formed day is accepted', ok(attendanceDaySchema, { date: '2026-08-04' }));
t('the 31st of February is refused', !ok(attendanceDaySchema, { date: '2026-02-31' }));
t('a 13th month is refused', !ok(attendanceMonthSchema, { month: '2026-13' }));
t('a slashed date is refused', !ok(attendanceDaySchema, { date: '04/08/2026' }));
t('a month is YYYY-MM', ok(attendanceMonthSchema, { month: '2026-08' }));
t('a month cannot smuggle in a day', !ok(attendanceMonthSchema, { month: '2026-08-04' }));

console.log('\n--- marking a day ---');
t('a valid batch is accepted', ok(markDaySchema, { date: '2026-08-04', entries: [ENTRY] }));
t('notes default to empty',
  markDaySchema.parse({ date: '2026-08-04', entries: [ENTRY] }).entries[0].notes === '');
t('an empty batch is refused — there is nothing to record',
  !ok(markDaySchema, { date: '2026-08-04', entries: [] }));
t('an unbounded batch is refused',
  !ok(markDaySchema, {
    date: '2026-08-04',
    entries: Array.from({ length: 101 }, () => ENTRY),
  }));
t('every attendance status is accepted',
  ['present', 'absent', 'half_day', 'leave'].every((status) =>
    ok(markDaySchema, { date: '2026-08-04', entries: [{ employee: ID, status }] })));
t('an invented status is refused',
  !ok(markDaySchema, { date: '2026-08-04', entries: [{ employee: ID, status: 'sabbatical' }] }));
t('a malformed employee id is refused',
  !ok(markDaySchema, { date: '2026-08-04', entries: [{ employee: 'nope', status: 'present' }] }));
t('unknown keys are refused (.strict)',
  !ok(markDaySchema, { date: '2026-08-04', entries: [{ ...ENTRY, paid: true }] }));
t('an empty correction is refused', !ok(updateAttendanceSchema, {}));

console.log('\n--- a day means a day ---');
// Without the normaliser, marks made at 09:14 and 17:40 are two rows the unique
// index cannot see as duplicates — and a day that pays twice.
t('writes are normalised to UTC midnight', /setUTCHours\(0, 0, 0, 0\)/.test(model));
t('the normaliser runs before validation', /pre\('validate'/.test(model));
t('one record per employee per day, enforced by the database',
  /\{ employee: 1, date: 1 \}, \{ unique: true \}/.test(model));
t('a date-leading index serves the whole-month reads',
  /\{ date: 1, employee: 1 \}/.test(model));
t('who marked it is part of the record, since it decides a wage',
  /markedBy[\s\S]{0,160}required:/.test(model));

console.log('\n--- marking is idempotent ---');
// An admin who re-submits the morning must overwrite it, not double it.
t('the day is written in one bulkWrite', /Attendance\.bulkWrite/.test(ctl));
t('each entry is an upsert, not an insert', /upsert: true/.test(ctl));
t('keyed on employee and day', /filter: \{ employee: entry\.employee, date: day \}/.test(ctl));
t('it is not a loop of saves', !/for \([\s\S]{0,120}await .*\.save\(\)/.test(ctl));

console.log('\n--- a batch cannot mint attendance for arbitrary ids ---');
t('ids are checked against the roster before anything is written',
  /User\.countDocuments/.test(ctl));
t('the check is scoped to shift-working staff', /PIN_ROLES/.test(ctl));
t('a mismatch refuses the whole batch', /do not match an active cashier/.test(read('src/controllers/attendanceController.js')));
t('the check runs BEFORE the write',
  ctl.indexOf('User.countDocuments') < ctl.indexOf('Attendance.bulkWrite'));
t('a duplicated employee in one submission is refused',
  /appears twice in one submission/.test(read('src/controllers/attendanceController.js')));

console.log('\n--- reads show the whole roster ---');
// A screen that lists only the already-marked is a screen that hides the person
// you forgot.
t('unmarked staff still appear, with a null status', /status: record\?\.status \?\? null/.test(ctl));
t('the marked count is reported so the gap is visible', /marked: records\.length/.test(ctl));
t('the month view reports the calendar length too', /daysInMonth\(month\)/.test(ctl));

console.log('\n--- the batch is audited once, not per employee ---');
t('one entry carries the date and the count',
  /AUDIT_ACTION\.ATTENDANCE_MARK[\s\S]{0,240}count: entries\.length/.test(ctl));

console.log('\n--- payroll schemas ---');
t('a payroll month is required', !ok(payrollMonthSchema, {}));
t('the route key is an employee and a month',
  ok(payrollKeyParamsSchema, { employeeId: ID, month: '2026-08' }));
t('a bad month in the path is refused',
  !ok(payrollKeyParamsSchema, { employeeId: ID, month: '2026-8' }));
t('an empty adjustment is refused', !ok(adjustPayrollSchema, {}));
t('a bonus is converted to minor units at the boundary',
  adjustPayrollSchema.parse({ bonus: '1500' }).bonusMinor === 150000);
t('a zero adjustment is allowed — it is how a mistake is cleared',
  adjustPayrollSchema.parse({ deduction: '0' }).deductionMinor === 0);
t('three decimal places are refused', !ok(adjustPayrollSchema, { bonus: '10.555' }));

console.log('\n--- route wiring ---');
const routes = [...routeSrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
t('5 attendance routes declared', routes.length === 5, String(routes.length));
t('requireAuth applied router-wide', /router\.use\(requireAuth\(\)\)/.test(routeSrc));
t('user:manage applied router-wide',
  /router\.use\(requirePermission\(PERMISSIONS\.USER_MANAGE\)\)/.test(routeSrc));
t('/day is declared before /:id, or the id route swallows it',
  routeSrc.indexOf("'/day'") < routeSrc.indexOf("'/:id'"));
t('every attendance route validates its input',
  routeSrc.split(/router\.(?:get|post|patch|delete)\(/).slice(1)
    .every((block) => /validate\(\{/.test(block)));
t('payroll is behind the same permission',
  /router\.use\(requirePermission\(PERMISSIONS\.USER_MANAGE\)\)/.test(payrollRouteSrc));
t('every payroll route validates its input',
  payrollRouteSrc.split(/router\.(?:get|post|patch)\(/).slice(1)
    .every((block) => /validate\(\{/.test(block)));

console.log('\n--- auth wall (live HTTP) ---');
const ROUTES = [
  ['GET', '/api/attendance?month=2026-08'],
  ['GET', '/api/attendance/day?date=2026-08-04'],
  ['POST', '/api/attendance/day'],
  ['PATCH', `/api/attendance/${ID}`],
  ['DELETE', `/api/attendance/${ID}`],
  ['GET', '/api/payroll?month=2026-08'],
  ['PATCH', `/api/payroll/${ID}/2026-08`],
  ['POST', `/api/payroll/${ID}/2026-08/pay`],
  ['POST', `/api/payroll/${ID}/2026-08/unpay`],
];

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  let denied = 0;
  for (const [method, route] of ROUTES) {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    });
    if (res.status === 401) denied += 1;
  }
  t(`all ${ROUTES.length} attendance and payroll routes reject an anonymous caller`,
    denied === ROUTES.length, `${denied}/${ROUTES.length}`);
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
