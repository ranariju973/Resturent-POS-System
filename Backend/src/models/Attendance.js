/**
 * One employee's attendance for one day.
 *
 * Marked by an admin from the Employees screen — there is no clock-in device,
 * so this collection is the only record of who worked. That makes it payroll
 * input rather than a report: `computePayroll` reads nothing else to decide
 * what a month is worth, which is why `markedBy` is required and why the
 * per-day uniqueness is enforced by the database rather than by the handler.
 *
 * ── Dates are UTC midnight, always ─────────────────────────────────────────
 * `date` identifies a DAY, not a moment. Two marks for the same day made at
 * 09:14 and 17:40 must be the same record, so every write is normalised to
 * midnight before it lands. Skipping that normalisation does not produce an
 * error — it produces two rows the unique index cannot see as duplicates, and
 * a day that pays twice.
 */
import mongoose from 'mongoose';
import { ATTENDANCE_STATUS_VALUES } from '../constants/enums.js';
import { tenantScoped } from './plugins/tenantScoped.js';

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'An attendance record needs an employee'],
    },

    /** UTC midnight of the day being marked. Half of the uniqueness key. */
    date: { type: Date, required: [true, 'An attendance record needs a date'] },

    status: {
      type: String,
      required: true,
      enum: { values: ATTENDANCE_STATUS_VALUES, message: '{VALUE} is not a valid status' },
    },

    /** 'Left early — dentist'. Short free text, for the awkward days. */
    notes: { type: String, trim: true, maxlength: 200, default: '' },

    /**
     * Who marked it. Required, unlike most audit-ish fields here: this record
     * decides what somebody is paid, so "who said they were absent" is part of
     * the record rather than a nicety.
     */
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'An attendance record needs a marker'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

attendanceSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/**
 * Normalise to UTC midnight before validation.
 *
 * Defensive: the validator already only accepts YYYY-MM-DD and the controller
 * builds the Date itself. This is the backstop that makes the unique index
 * below mean what it says no matter which path wrote the record.
 */
attendanceSchema.pre('validate', function normaliseDay(next) {
  if (this.date instanceof Date && !Number.isNaN(this.date.getTime())) {
    this.date.setUTCHours(0, 0, 0, 0);
  }
  return next();
});

/**
 * One record per employee per day — enforced by the database, not by a
 * read-then-write in the handler, which two concurrent marks would race past.
 *
 * This index also serves "one employee across a month" as a prefix range scan,
 * so no separate { employee: 1 } index is needed.
 */
attendanceSchema.plugin(tenantScoped, {
  unique: [{ fields: { employee: 1, date: 1 } }],
});

/**
 * The other direction: "everyone, for this month" — the payroll aggregation
 * and the Attendance tab. Date-leading, because both of those start from a
 * range of days and fan out to employees.
 */
attendanceSchema.index({ tenantId: 1, date: 1, employee: 1 });

export const Attendance = mongoose.model('Attendance', attendanceSchema);

export default Attendance;
