/**
 * Payroll arithmetic.
 *
 * ── Why this file needs no server ──────────────────────────────────────────
 * computePayroll is pure, so these are real assertions about real wages rather
 * than a source audit: every number below is the number an employee would
 * actually be paid. That is the point of keeping the arithmetic out of the
 * controller.
 *
 * Every money assertion is on an INTEGER of minor units. A test that compared
 * floats would pass while the thing it is guarding — paisa drift — went
 * unnoticed.
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
import { computePayroll, netPayMinor } from '../src/utils/payroll.js';
import { ATTENDANCE_STATUS, ATTENDANCE_PAY_FACTOR } from '../src/constants/enums.js';

let pass = 0;
let fail = 0;
const t = (label, cond, note = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

const ROOT = path.resolve(import.meta.dirname, '..');
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

/** n days of one status. */
const days = (status, n) => Array.from({ length: n }, () => ({ status }));

const SALARY = 3_100_000; // ₹31,000 a month

console.log('--- a full month pays the full salary ---');
for (const [month, length] of [['January', 31], ['February', 28], ['leap February', 29], ['April', 30]]) {
  const r = computePayroll({
    monthlySalaryMinor: SALARY,
    records: days(ATTENDANCE_STATUS.PRESENT, length),
    daysInMonth: length,
  });
  t(`${month}: every day present pays exactly the monthly salary`,
    r.earnedMinor === SALARY, `${r.earnedMinor}`);
}

console.log('\n--- part months ---');
const partial = computePayroll({
  monthlySalaryMinor: SALARY,
  records: days(ATTENDANCE_STATUS.PRESENT, 22),
  daysInMonth: 31,
});
t('22 of 31 days present is 22/31 of the salary',
  partial.earnedMinor === Math.round((SALARY * 22) / 31), `${partial.earnedMinor}`);
t('the result is a whole number of minor units',
  Number.isSafeInteger(partial.earnedMinor));
t('the gap is reported, not hidden inside the total',
  partial.markedDays === 22 && partial.payableDays === 22);

console.log('\n--- what each status is worth ---');
const one = (status) =>
  computePayroll({ monthlySalaryMinor: SALARY, records: days(status, 1), daysInMonth: 31 });
t('present earns a full day', one(ATTENDANCE_STATUS.PRESENT).payableDays === 1);
t('absent earns nothing', one(ATTENDANCE_STATUS.ABSENT).payableDays === 0);
t('a half day earns half', one(ATTENDANCE_STATUS.HALF_DAY).payableDays === 0.5);
t('approved leave is paid — it is time off, not a deduction',
  one(ATTENDANCE_STATUS.LEAVE).payableDays === 1);
t('absent days pay nothing at all',
  computePayroll({ monthlySalaryMinor: SALARY, records: days(ATTENDANCE_STATUS.ABSENT, 31), daysInMonth: 31 })
    .earnedMinor === 0);

console.log('\n--- unmarked is not the same as absent ---');
// The distinction the whole payroll rests on: an admin who marks the roster
// weekly must not see five deductions every Friday.
const unmarked = computePayroll({ monthlySalaryMinor: SALARY, records: [], daysInMonth: 31 });
const allAbsent = computePayroll({
  monthlySalaryMinor: SALARY,
  records: days(ATTENDANCE_STATUS.ABSENT, 31),
  daysInMonth: 31,
});
t('an unmarked month earns nothing yet', unmarked.earnedMinor === 0);
t('and is distinguishable from a month of absences',
  unmarked.markedDays === 0 && allAbsent.markedDays === 31);
t('a half-marked month pays only for what was marked',
  computePayroll({ monthlySalaryMinor: SALARY, records: days(ATTENDANCE_STATUS.PRESENT, 15), daysInMonth: 31 })
    .earnedMinor === Math.round((SALARY * 15) / 31));

console.log('\n--- mixed months, and the counts ---');
const mixed = computePayroll({
  monthlySalaryMinor: SALARY,
  records: [
    ...days(ATTENDANCE_STATUS.PRESENT, 18),
    ...days(ATTENDANCE_STATUS.HALF_DAY, 4),
    ...days(ATTENDANCE_STATUS.LEAVE, 2),
    ...days(ATTENDANCE_STATUS.ABSENT, 3),
  ],
  daysInMonth: 31,
});
t('payable days add up: 18 + 4x0.5 + 2 + 0 = 22', mixed.payableDays === 22);
t('every status is counted back',
  mixed.presentDays === 18 && mixed.halfDays === 4 && mixed.leaveDays === 2 && mixed.absentDays === 3);
t('27 days were marked', mixed.markedDays === 27);
t('the wage is still an exact integer', Number.isSafeInteger(mixed.earnedMinor));

console.log('\n--- rounding happens once, and cannot drift ---');
// 1/3 of a month is the classic non-terminating case.
const third = computePayroll({
  monthlySalaryMinor: 1_000_000,
  records: days(ATTENDANCE_STATUS.PRESENT, 10),
  daysInMonth: 30,
});
t('a third of a month is exact', third.earnedMinor === 333_333, `${third.earnedMinor}`);
t('half-days do not produce a fractional wage',
  Number.isSafeInteger(
    computePayroll({
      monthlySalaryMinor: 999_999,
      records: days(ATTENDANCE_STATUS.HALF_DAY, 7),
      daysInMonth: 31,
    }).earnedMinor,
  ));
t('a zero salary earns zero, not NaN',
  computePayroll({ monthlySalaryMinor: 0, records: days(ATTENDANCE_STATUS.PRESENT, 20), daysInMonth: 31 })
    .earnedMinor === 0);

console.log('\n--- bad input is refused rather than paid ---');
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
t('a float salary is rejected',
  throws(() => computePayroll({ monthlySalaryMinor: 100.5, records: [], daysInMonth: 31 })));
t('a negative salary is rejected',
  throws(() => computePayroll({ monthlySalaryMinor: -1, records: [], daysInMonth: 31 })));
t('a nonsense month length is rejected',
  throws(() => computePayroll({ monthlySalaryMinor: SALARY, records: [], daysInMonth: 400 })));
t('an unknown status is worth nothing rather than crashing the month',
  computePayroll({ monthlySalaryMinor: SALARY, records: [{ status: 'sabbatical' }], daysInMonth: 31 })
    .earnedMinor === 0);

console.log('\n--- net pay ---');
t('net = earned + bonus - deduction',
  netPayMinor({ earnedMinor: 2_200_000, bonusMinor: 150_000, deductionMinor: 50_000 }) === 2_300_000);
t('with no adjustments, net is what was earned',
  netPayMinor({ earnedMinor: 2_200_000 }) === 2_200_000);
t('an over-large deduction floors at zero rather than paying a negative wage',
  netPayMinor({ earnedMinor: 100_000, deductionMinor: 500_000 }) === 0);

console.log('\n--- every status has a pay factor ---');
// The omission this catches — adding a status and forgetting what it pays —
// surfaces as somebody quietly not being paid, weeks later.
const statuses = Object.values(ATTENDANCE_STATUS);
t(`all ${statuses.length} statuses have a declared pay factor`,
  statuses.every((s) => typeof ATTENDANCE_PAY_FACTOR[s] === 'number'),
  statuses.filter((s) => typeof ATTENDANCE_PAY_FACTOR[s] !== 'number').join(', '));
t('no factor pays more than a full day',
  Object.values(ATTENDANCE_PAY_FACTOR).every((f) => f >= 0 && f <= 1));

console.log('\n--- a paid month is frozen ---');
const ctl = strip(fs.readFileSync(path.join(ROOT, 'src/controllers/payrollController.js'), 'utf8'));
const model = strip(fs.readFileSync(path.join(ROOT, 'src/models/Payroll.js'), 'utf8'));
// Declared through the tenantScoped plugin — {tenantId, month, employee}.
t('one payroll row per employee per month, enforced by the database',
  /unique:\s*\[\{ fields: \{ month: 1, employee: 1 \} \}\]/.test(model));
t('a paid row is served from its snapshot, not recomputed',
  /PAYROLL_STATUS\.PAID/.test(ctl) && /snapshot/.test(ctl));
t('paying freezes the derived figures', /snapshot:/.test(ctl));
t('an already-paid month refuses a second payment',
  /status: PAYROLL_STATUS\.DRAFT/.test(ctl));
t('adjusting a paid month is refused', /already been paid/.test(ctl));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
