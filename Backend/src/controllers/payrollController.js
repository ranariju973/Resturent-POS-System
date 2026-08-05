/**
 * Payroll handlers. Admin only — `user:manage`.
 *
 * ── The one rule this file exists to enforce ───────────────────────────────
 * A DRAFT month is computed, a PAID month is remembered.
 *
 * While a month is draft, every figure is recomputed from Attendance on each
 * read, so correcting a day immediately corrects the wage. Once the money is
 * handed over, the figures are frozen into the row's snapshot and served from
 * there forever — an attendance correction made afterwards must not restate
 * what was actually paid.
 *
 * Everything else here follows from that: why rows are synthetic until an
 * adjustment is entered, why paying is a conditional update, and why unpaying
 * is a separate audited action rather than an edit.
 */
import mongoose from 'mongoose';
import { Payroll } from '../models/Payroll.js';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, PAYROLL_STATUS, PIN_ROLES, ROLE_LABELS } from '../constants/enums.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { computePayroll, netPayMinor } from '../utils/payroll.js';
import { toMajor } from '../utils/money.js';
import { daysInMonth } from './attendanceController.js';

function monthBounds(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

const rosterFilter = () => ({
  // trusted() because sanitizeFilter is enabled globally (src/config/db.js).
  role: mongoose.trusted({ $in: [...PIN_ROLES] }),
  isActive: true,
});

/**
 * Assemble one row for the client.
 *
 * Money is returned in both units — `netMinor` alongside `net` — matching the
 * convention the reports endpoints already use, so the UI never has to divide
 * by 100 in a template.
 */
function buildRow({ employee, month, doc, derived, days }) {
  const paid = doc?.status === PAYROLL_STATUS.PAID;

  // A paid row is served from what was frozen at payment. A draft row tracks
  // attendance. This branch IS the freeze.
  const figures = paid
    ? doc.snapshot
    : { ...derived, daysInMonth: days };

  const bonusMinor = doc?.bonusMinor ?? 0;
  const deductionMinor = doc?.deductionMinor ?? 0;
  const earnedMinor = figures.earnedMinor ?? 0;
  const netMinor = paid
    ? doc.snapshot.netMinor
    : netPayMinor({ earnedMinor, bonusMinor, deductionMinor });

  return {
    employee: {
      id: String(employee._id),
      name: employee.name,
      role: employee.role,
      roleLabel: ROLE_LABELS[employee.role] ?? employee.role,
    },
    month,
    status: doc?.status ?? PAYROLL_STATUS.DRAFT,

    baseSalaryMinor: paid ? doc.baseSalaryMinor : employee.monthlySalaryMinor ?? 0,
    baseSalary: toMajor(paid ? doc.baseSalaryMinor : employee.monthlySalaryMinor ?? 0),

    daysInMonth: figures.daysInMonth ?? days,
    markedDays: figures.markedDays ?? 0,
    payableDays: figures.payableDays ?? 0,
    presentDays: figures.presentDays ?? 0,
    absentDays: figures.absentDays ?? 0,
    halfDays: figures.halfDays ?? 0,
    leaveDays: figures.leaveDays ?? 0,

    earnedMinor,
    earned: toMajor(earnedMinor),
    bonusMinor,
    bonus: toMajor(bonusMinor),
    deductionMinor,
    deduction: toMajor(deductionMinor),
    netMinor,
    net: toMajor(netMinor),

    paidAt: doc?.paidAt ?? null,
    notes: doc?.notes ?? '',
  };
}

/**
 * Every input a month's rows need: the roster, their attendance grouped by
 * employee, and any stored payroll documents.
 *
 * One aggregation for attendance rather than a query per employee — a roster of
 * twenty would otherwise be twenty round trips to render one screen.
 */
async function loadMonth(month, employeeId = null) {
  const { start, end } = monthBounds(month);

  const staffFilter = employeeId
    ? { _id: new mongoose.Types.ObjectId(employeeId), ...rosterFilter() }
    : rosterFilter();

  const attendanceMatch = { date: mongoose.trusted({ $gte: start, $lt: end }) };
  if (employeeId) attendanceMatch.employee = new mongoose.Types.ObjectId(employeeId);

  const payrollFilter = { month };
  if (employeeId) payrollFilter.employee = new mongoose.Types.ObjectId(employeeId);

  const [staff, grouped, docs] = await Promise.all([
    User.find(staffFilter).select('name role monthlySalaryMinor').sort({ name: 1 }),
    Attendance.aggregate([
      { $match: attendanceMatch },
      { $group: { _id: '$employee', records: { $push: { status: '$status' } } } },
    ]),
    Payroll.find(payrollFilter),
  ]);

  return {
    staff,
    byEmployee: new Map(grouped.map((g) => [String(g._id), g.records])),
    docs: new Map(docs.map((d) => [String(d.employee), d])),
    days: daysInMonth(month),
  };
}

// ---------------------------------------------------------------------------
// GET /api/payroll?month=YYYY-MM
// ---------------------------------------------------------------------------
export const getPayroll = asyncHandler(async (req, res) => {
  const { month, employee } = req.query;
  const { staff, byEmployee, docs, days } = await loadMonth(month, employee);

  const rows = staff.map((member) => {
    const records = byEmployee.get(String(member._id)) ?? [];
    return buildRow({
      employee: member,
      month,
      doc: docs.get(String(member._id)) ?? null,
      derived: computePayroll({
        monthlySalaryMinor: member.monthlySalaryMinor ?? 0,
        records,
        daysInMonth: days,
      }),
      days,
    });
  });

  const totals = rows.reduce(
    (acc, row) => ({
      earnedMinor: acc.earnedMinor + row.earnedMinor,
      bonusMinor: acc.bonusMinor + row.bonusMinor,
      deductionMinor: acc.deductionMinor + row.deductionMinor,
      netMinor: acc.netMinor + row.netMinor,
      paid: acc.paid + (row.status === PAYROLL_STATUS.PAID ? 1 : 0),
    }),
    { earnedMinor: 0, bonusMinor: 0, deductionMinor: 0, netMinor: 0, paid: 0 },
  );

  return sendSuccess(res, {
    month,
    daysInMonth: days,
    rows,
    totals: {
      ...totals,
      earned: toMajor(totals.earnedMinor),
      bonus: toMajor(totals.bonusMinor),
      deduction: toMajor(totals.deductionMinor),
      net: toMajor(totals.netMinor),
      employees: rows.length,
    },
  });
});

/** Load one employee's row inputs, 404ing if they are not on the roster. */
async function requireRosterMember(employeeId, month) {
  const loaded = await loadMonth(month, employeeId);
  const member = loaded.staff[0];
  if (!member) throw ApiError.notFound('Employee not found');
  return { ...loaded, member };
}

// ---------------------------------------------------------------------------
// PATCH /api/payroll/:employeeId/:month
// ---------------------------------------------------------------------------
/**
 * Record a bonus or deduction.
 *
 * This is the write that brings a stored row into existence — until an admin
 * adjusts something, a month is computed rather than saved.
 */
export const adjustPayroll = asyncHandler(async (req, res) => {
  const { employeeId, month } = req.params;
  const { member, byEmployee, days } = await requireRosterMember(employeeId, month);

  const existing = await Payroll.findOne({ employee: member._id, month });
  if (existing?.status === PAYROLL_STATUS.PAID) {
    throw ApiError.conflict(
      'This month has already been paid. Reopen it before changing the figures.',
    );
  }

  const doc =
    existing ??
    new Payroll({ employee: member._id, month, baseSalaryMinor: member.monthlySalaryMinor ?? 0 });

  Object.assign(doc, req.body);
  await doc.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.PAYROLL_ADJUST,
      resource: 'Payroll',
      resourceId: doc._id,
      meta: { month, fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, {
    row: buildRow({
      employee: member,
      month,
      doc,
      derived: computePayroll({
        monthlySalaryMinor: member.monthlySalaryMinor ?? 0,
        records: byEmployee.get(String(member._id)) ?? [],
        daysInMonth: days,
      }),
      days,
    }),
  });
});

// ---------------------------------------------------------------------------
// POST /api/payroll/:employeeId/:month/pay
// ---------------------------------------------------------------------------
/**
 * Settle a month. This is the freeze.
 *
 * The derived figures are recomputed one last time and written into `snapshot`,
 * after which reads serve those and ignore attendance entirely.
 *
 * The write is conditional on the row still being draft, so a double-click
 * cannot pay twice: the second attempt matches nothing, and the upsert it then
 * tries loses to the unique index — which is caught below and reported as
 * "already paid" rather than a duplicate-key error.
 */
export const markPayrollPaid = asyncHandler(async (req, res) => {
  const { employeeId, month } = req.params;
  const { member, byEmployee, days } = await requireRosterMember(employeeId, month);

  const existing = await Payroll.findOne({ employee: member._id, month });
  if (existing?.status === PAYROLL_STATUS.PAID) {
    throw ApiError.conflict('This month has already been paid.');
  }

  const derived = computePayroll({
    monthlySalaryMinor: member.monthlySalaryMinor ?? 0,
    records: byEmployee.get(String(member._id)) ?? [],
    daysInMonth: days,
  });

  const bonusMinor = existing?.bonusMinor ?? 0;
  const deductionMinor = existing?.deductionMinor ?? 0;
  const netMinor = netPayMinor({ earnedMinor: derived.earnedMinor, bonusMinor, deductionMinor });

  const update = {
    $set: {
      status: PAYROLL_STATUS.PAID,
      paidAt: new Date(),
      paidBy: req.user.id,
      baseSalaryMinor: member.monthlySalaryMinor ?? 0,
      bonusMinor,
      deductionMinor,
      snapshot: { ...derived, daysInMonth: days, netMinor },
      ...(req.body.notes ? { notes: req.body.notes } : {}),
    },
    $setOnInsert: { employee: member._id, month },
  };

  let doc;
  try {
    doc = await Payroll.findOneAndUpdate(
      { employee: member._id, month, status: PAYROLL_STATUS.DRAFT },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    // The row was paid between the check above and this write.
    if (err?.code === 11000) throw ApiError.conflict('This month has already been paid.');
    throw err;
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.PAYROLL_PAID,
      resource: 'Payroll',
      resourceId: doc._id,
      // Carries the figures: this entry is the durable record of the payment.
      meta: { month, employee: String(member._id), netMinor, payableDays: derived.payableDays },
    },
    req,
  );

  return sendSuccess(res, { row: buildRow({ employee: member, month, doc, derived, days }) });
});

// ---------------------------------------------------------------------------
// POST /api/payroll/:employeeId/:month/unpay
// ---------------------------------------------------------------------------
/**
 * Reopen a settled month.
 *
 * Exists because the alternative is that a mispayment is permanent. It is the
 * one action here that unmakes a settled figure, so it is audited apart from
 * the adjustment that will follow it — "who reopened March" is a question
 * somebody will eventually ask.
 */
export const unmarkPayrollPaid = asyncHandler(async (req, res) => {
  const { employeeId, month } = req.params;
  const { member, byEmployee, days } = await requireRosterMember(employeeId, month);

  const doc = await Payroll.findOne({ employee: member._id, month });
  if (!doc || doc.status !== PAYROLL_STATUS.PAID) {
    throw ApiError.conflict('This month has not been paid.');
  }

  const wasNetMinor = doc.snapshot?.netMinor ?? 0;

  doc.status = PAYROLL_STATUS.DRAFT;
  doc.paidAt = null;
  doc.paidBy = null;
  doc.snapshot = undefined;
  await doc.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.PAYROLL_UNPAID,
      resource: 'Payroll',
      resourceId: doc._id,
      meta: { month, employee: String(member._id), reversedNetMinor: wasNetMinor },
    },
    req,
  );

  return sendSuccess(res, {
    row: buildRow({
      employee: member,
      month,
      doc,
      derived: computePayroll({
        monthlySalaryMinor: member.monthlySalaryMinor ?? 0,
        records: byEmployee.get(String(member._id)) ?? [],
        daysInMonth: days,
      }),
      days,
    }),
  });
});

export default {
  getPayroll,
  adjustPayroll,
  markPayrollPaid,
  unmarkPayrollPaid,
};
