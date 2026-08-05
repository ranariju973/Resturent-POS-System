/**
 * Payroll arithmetic.
 *
 * Pure by design: no database, no clock, no request. Everything it needs is an
 * argument, so a month's wage can be reasoned about — and tested — without
 * standing a server up. Wages are the one number in this system a person will
 * check by hand, so it is worth being able to prove.
 *
 * ── Everything here is in MINOR units ──────────────────────────────────────
 * Same convention as the rest of the app (see money.js): integers throughout,
 * with the single division rounded exactly once. A float salary that drifts by
 * a paisa is a wage slip somebody has to argue about.
 */
import { ATTENDANCE_PAY_FACTOR } from '../constants/enums.js';
import { isValidMinor } from './money.js';

/**
 * What one month owes one employee.
 *
 * ── Why unmarked days are worth nothing rather than counting as absent ─────
 * A day with no attendance record means "nobody has said yet", not "they did
 * not come". Treating the gap as an absence would mean an admin who marks the
 * roster every Friday sees five deductions every week and has to chase figures
 * that were never wrong. So pay accrues only for days actually marked, and the
 * caller is handed `markedDays` alongside `daysInMonth` so the UI can show the
 * gap honestly — "22 of 31 days marked" — instead of hiding it inside a total.
 *
 * ── Why the divisor is the calendar month, not 30 ──────────────────────────
 * A monthly salary is a monthly salary: February pays the same as March. Fixing
 * the divisor at 30 would quietly pay 28-day months a little over and 31-day
 * months a little under, every year, forever.
 *
 * @param {object} input
 * @param {number} input.monthlySalaryMinor Full-month salary, minor units.
 * @param {Array<{status: string}>} input.records That employee's marked days.
 * @param {number} input.daysInMonth Calendar length of the month.
 * @returns {{markedDays: number, payableDays: number, earnedMinor: number,
 *   presentDays: number, absentDays: number, halfDays: number, leaveDays: number}}
 */
export function computePayroll({ monthlySalaryMinor, records = [], daysInMonth }) {
  if (!isValidMinor(monthlySalaryMinor)) {
    throw new TypeError('monthlySalaryMinor must be a non-negative integer in minor units');
  }
  if (!Number.isSafeInteger(daysInMonth) || daysInMonth < 28 || daysInMonth > 31) {
    throw new TypeError('daysInMonth must be a real calendar month length');
  }

  const counts = { present: 0, absent: 0, half_day: 0, leave: 0 };
  let payableDays = 0;

  for (const record of records) {
    // An unknown status contributes nothing rather than throwing: a record
    // written by an older version of the app should not be able to stop the
    // whole month's payroll from rendering.
    payableDays += ATTENDANCE_PAY_FACTOR[record.status] ?? 0;
    if (record.status in counts) counts[record.status] += 1;
  }

  // The one division, rounded exactly once. payableDays can be fractional
  // (half-days), which is precisely why this cannot be integer arithmetic all
  // the way down and why the rounding is pinned here rather than at a call site.
  const earnedMinor = Math.round((monthlySalaryMinor * payableDays) / daysInMonth);

  return {
    markedDays: records.length,
    payableDays,
    earnedMinor,
    presentDays: counts.present,
    absentDays: counts.absent,
    halfDays: counts.half_day,
    leaveDays: counts.leave,
  };
}

/**
 * Take-home for a month: what was earned, plus a bonus, less a deduction.
 *
 * Floored at zero. A deduction larger than the month's earnings is a data-entry
 * mistake, and paying a negative wage is not a thing that should be expressible
 * — the admin gets a zero and can see the numbers that produced it.
 */
export function netPayMinor({ earnedMinor, bonusMinor = 0, deductionMinor = 0 }) {
  return Math.max(0, earnedMinor + bonusMinor - deductionMinor);
}

export default { computePayroll, netPayMinor };
