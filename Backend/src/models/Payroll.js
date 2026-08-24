/**
 * One employee's pay for one month.
 *
 * ── What is stored here, and what is not ───────────────────────────────────
 * Most of a payroll row is DERIVED: the days worked, and therefore the amount
 * earned, are recomputed from the Attendance collection on every read. Storing
 * them would mean a figure that silently disagrees with the attendance it came
 * from the moment anybody corrects a day.
 *
 * What genuinely lives here is what nothing else can produce:
 *   • the bonus and deduction an admin typed
 *   • whether the month has been paid, when, and by whom
 *   • `snapshot` — see below
 *
 * ── Why a paid month freezes ───────────────────────────────────────────────
 * While `status` is 'draft' the figures track attendance, which is what makes
 * "mark a day, watch the wage update" work. The moment the money is handed
 * over, that must stop: what was paid on the 3rd is a fact, and an attendance
 * correction made on the 10th must not rewrite it. So paying copies the derived
 * figures into `snapshot`, and from then on the API serves those verbatim.
 *
 * A draft row only needs to exist once an adjustment is entered — an untouched
 * month is computed on the fly rather than stored, so no month costs N empty
 * documents up front.
 */
import mongoose from 'mongoose';
import { PAYROLL_STATUS, PAYROLL_STATUS_VALUES } from '../constants/enums.js';
import { minorField } from '../utils/money.js';
import { tenantScoped } from './plugins/tenantScoped.js';

const payrollSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A payroll row needs an employee'],
    },

    /** YYYY-MM. A calendar key, not a timestamp — never do arithmetic on it. */
    month: {
      type: String,
      required: [true, 'A payroll row needs a month'],
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM'],
    },

    /**
     * The salary this row was settled against, copied from the user at payment
     * time. Kept because a raise next month must not restate last month's slip.
     */
    baseSalaryMinor: minorField({ required: false, default: 0 }),

    bonusMinor: minorField({ required: false, default: 0 }),
    deductionMinor: minorField({ required: false, default: 0 }),

    status: {
      type: String,
      enum: { values: PAYROLL_STATUS_VALUES, message: '{VALUE} is not a valid payroll status' },
      default: PAYROLL_STATUS.DRAFT,
      index: true,
    },

    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * The attendance-derived figures as they stood when the money was paid.
     * Null while draft; authoritative once paid.
     */
    snapshot: {
      daysInMonth: { type: Number, default: 0 },
      markedDays: { type: Number, default: 0 },
      payableDays: { type: Number, default: 0 },
      presentDays: { type: Number, default: 0 },
      absentDays: { type: Number, default: 0 },
      halfDays: { type: Number, default: 0 },
      leaveDays: { type: Number, default: 0 },
      earnedMinor: { type: Number, default: 0 },
      netMinor: { type: Number, default: 0 },
    },

    notes: { type: String, trim: true, maxlength: 300, default: '' },
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

payrollSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/**
 * One row per employee per month, enforced by the database.
 *
 * This is what makes "mark paid" safe to click twice: the second write loses
 * against the index rather than creating a second payment for the same month.
 */
payrollSchema.plugin(tenantScoped, {
  unique: [{ fields: { month: 1, employee: 1 } }],
});

/** One employee's pay history, most recent first. */
payrollSchema.index({ tenantId: 1, employee: 1, month: -1 });

export const Payroll = mongoose.model('Payroll', payrollSchema);

export default Payroll;
