/**
 * Attendance handlers. Admin only — `user:manage`.
 *
 * There is no clock-in device: an admin marks the roster by hand, so these
 * endpoints are the sole source of who worked, and therefore the sole input to
 * payroll. Two consequences run through the file:
 *
 *   • Writes are IDEMPOTENT. An admin who re-submits the morning must overwrite
 *     the day, not double it. That is an upsert against the unique index, not a
 *     read-then-write the second click can race past.
 *   • Reads return the WHOLE roster, including people with no record yet. A
 *     screen that only lists the already-marked is a screen that quietly hides
 *     the person you forgot.
 */
import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, PIN_ROLES, ROLE_LABELS } from '../constants/enums.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { requireTenantId } from '../utils/tenantContext.js';

/** 'YYYY-MM-DD' -> the Date the model stores. */
const toDay = (iso) => new Date(`${iso}T00:00:00.000Z`);

/** First instant of a month, and of the month after it. */
function monthBounds(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

/** Calendar days in a YYYY-MM. Payroll divides by this, so it is not 30. */
export function daysInMonth(month) {
  const { start } = monthBounds(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
}

const publicRecord = (record) => ({
  id: String(record._id),
  employee: String(record.employee),
  date: record.date,
  status: record.status,
  notes: record.notes ?? '',
});

/** The roster attendance is marked against: active staff who work shifts. */
function rosterFilter() {
  // trusted() because sanitizeFilter is enabled globally (src/config/db.js).
  return { role: mongoose.trusted({ $in: [...PIN_ROLES] }), isActive: true };
}

const publicStaff = (user) => ({
  id: String(user._id),
  name: user.name,
  role: user.role,
  roleLabel: ROLE_LABELS[user.role] ?? user.role,
});

// ---------------------------------------------------------------------------
// GET /api/attendance/day?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
/**
 * One day, as a complete roster.
 *
 * Everybody on shift-working staff appears, with `status: null` for anyone not
 * yet marked. The UI renders that as an unanswered row rather than an absence,
 * which is the distinction the whole payroll rests on: unmarked is "we have not
 * said", not "they did not come".
 */
export const getAttendanceDay = asyncHandler(async (req, res) => {
  const day = toDay(req.query.date);

  const [staff, records] = await Promise.all([
    User.find(rosterFilter()).select('name role').sort({ name: 1 }),
    Attendance.find({ date: day }),
  ]);

  const byEmployee = new Map(records.map((r) => [String(r.employee), r]));

  const rows = staff.map((member) => {
    const record = byEmployee.get(String(member._id));
    return {
      employee: publicStaff(member),
      recordId: record ? String(record._id) : null,
      status: record?.status ?? null,
      notes: record?.notes ?? '',
    };
  });

  return sendSuccess(res, { date: req.query.date, rows, marked: records.length });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/day
// ---------------------------------------------------------------------------
/**
 * Mark a whole day in one write.
 *
 * Idempotent by construction: each entry is an upsert keyed on
 * (employee, date), so re-submitting the day overwrites rather than
 * duplicating, and the unique index means two admins saving at once cannot
 * resolve into two rows for one person.
 *
 * The id check is not ceremony. Without it an admin could POST arbitrary
 * ObjectIds and mint attendance — and therefore salary — against records that
 * are not employees at all.
 */
export const markAttendanceDay = asyncHandler(async (req, res) => {
  const { date, entries } = req.body;
  const day = toDay(date);

  const ids = entries.map((e) => e.employee);
  const unique = [...new Set(ids.map(String))];
  if (unique.length !== ids.length) {
    throw ApiError.badRequest('The same employee appears twice in one submission');
  }

  const valid = await User.countDocuments({
    _id: mongoose.trusted({ $in: unique.map((id) => new mongoose.Types.ObjectId(id)) }),
    ...rosterFilter(),
  });
  if (valid !== unique.length) {
    throw ApiError.badRequest(
      'One or more entries do not match an active cashier or kitchen staff member',
    );
  }

  /*
   * ── The one place tenantId must be written by hand ────────────────────────
   * Every other query in this codebase is scoped automatically by the
   * tenantScoped plugin, which hooks Mongoose's query middleware. bulkWrite
   * runs NO query middleware, so nothing here is filtered or stamped unless it
   * says so explicitly.
   *
   * Both halves matter. Without it in `filter`, an upsert could match another
   * restaurant's row for the same employee id and date and overwrite it.
   * Without it in `$setOnInsert`, a newly created record would belong to no
   * restaurant and fail its own required check.
   *
   * tests/tenant-coverage.test.mjs asserts this specific call site, because it
   * is the single gap the plugin cannot close for us.
   */
  const tenantId = requireTenantId('markAttendanceDay');

  await Attendance.bulkWrite(
    entries.map((entry) => ({
      updateOne: {
        filter: { tenantId, employee: entry.employee, date: day },
        update: {
          $set: { status: entry.status, notes: entry.notes ?? '', markedBy: req.user.id },
          $setOnInsert: { tenantId, employee: entry.employee, date: day },
        },
        upsert: true,
      },
    })),
  );

  // One entry for the batch. Twenty staff marked every morning would otherwise
  // push twenty lines a day into the trail and bury everything else in it.
  await AuditLog.record(
    {
      action: AUDIT_ACTION.ATTENDANCE_MARK,
      resource: 'Attendance',
      meta: { date, count: entries.length },
    },
    req,
  );

  const records = await Attendance.find({ date: day });
  return sendSuccess(res, {
    date,
    marked: records.length,
    records: records.map(publicRecord),
  });
});

// ---------------------------------------------------------------------------
// GET /api/attendance?month=YYYY-MM[&employee=id]
// ---------------------------------------------------------------------------
/**
 * A month, per employee, with the per-status counts payroll will use.
 *
 * `marked` is reported alongside the calendar length so the UI can say "22 of
 * 31 days marked" — an admin who marks weekly needs to see the gap, not
 * discover it in a wage.
 */
export const getAttendanceMonth = asyncHandler(async (req, res) => {
  const { month, employee } = req.query;
  const { start, end } = monthBounds(month);

  const staffFilter = employee
    ? { _id: new mongoose.Types.ObjectId(employee), ...rosterFilter() }
    : rosterFilter();

  const recordFilter = { date: mongoose.trusted({ $gte: start, $lt: end }) };
  if (employee) recordFilter.employee = new mongoose.Types.ObjectId(employee);

  const [staff, records] = await Promise.all([
    User.find(staffFilter).select('name role').sort({ name: 1 }),
    Attendance.find(recordFilter).sort({ date: 1 }),
  ]);

  const byEmployee = new Map();
  for (const record of records) {
    const key = String(record.employee);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(record);
  }

  const employees = staff.map((member) => {
    const own = byEmployee.get(String(member._id)) ?? [];
    const summary = own.reduce(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
      {},
    );
    return {
      employee: publicStaff(member),
      records: own.map(publicRecord),
      summary: { ...summary, marked: own.length },
    };
  });

  return sendSuccess(res, { month, daysInMonth: daysInMonth(month), employees });
});

// ---------------------------------------------------------------------------
// PATCH /api/attendance/:id
// ---------------------------------------------------------------------------
/** Correct one record. The bulk endpoint handles the ordinary case. */
export const updateAttendance = asyncHandler(async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound('Attendance record not found');

  Object.assign(record, req.body);
  record.markedBy = req.user.id;
  await record.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.ATTENDANCE_UPDATE,
      resource: 'Attendance',
      resourceId: record._id,
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { record: publicRecord(record) });
});

// ---------------------------------------------------------------------------
// DELETE /api/attendance/:id
// ---------------------------------------------------------------------------
/**
 * Unmark a day.
 *
 * Deleting the row is right rather than setting some 'cleared' status: the
 * absence of a record already has a precise meaning here — "not yet marked" —
 * and reusing it costs nothing. Nothing references an attendance record, so
 * there is no guard.
 */
export const deleteAttendance = asyncHandler(async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound('Attendance record not found');

  const snapshot = {
    employee: String(record.employee),
    date: record.date,
    status: record.status,
  };

  await Attendance.deleteOne({ _id: record._id });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.ATTENDANCE_UPDATE,
      resource: 'Attendance',
      resourceId: record._id,
      meta: { ...snapshot, cleared: true },
    },
    req,
  );

  return sendSuccess(res, { deleted: true, id: String(record._id) });
});

export default {
  getAttendanceDay,
  markAttendanceDay,
  getAttendanceMonth,
  updateAttendance,
  deleteAttendance,
};
