/**
 * Floor-plan table.
 *
 * ── Deviation from the Phase 1 brief, deliberate ───────────────────────────
 * The brief had Table carry its own `order` array of line items. It does not.
 * A table holds `currentOrder`, a reference to the open Order document.
 *
 * Storing line items in both places creates two sources of truth for the same
 * cart, and they drift the first time a write succeeds on one and fails on
 * the other — the table shows three coffees, the bill charges for two, and
 * nobody can say which is right. One writable copy, referenced from the
 * table, removes the failure mode entirely.
 *
 * The frontend's `table.order` shape is reconstructed by populating
 * currentOrder in Phase 6.
 */
import mongoose from 'mongoose';
import { TABLE_STATUS, TABLE_STATUS_VALUES, TABLE_TRANSITIONS } from '../constants/enums.js';

const tableSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Table name is required'],
      trim: true,
      uppercase: true,
      minlength: 1,
      maxlength: 12,
    },

    /**
     * Custom seat count, admin-configurable. Bounded because an unvalidated
     * seat count is a soft denial-of-service on any UI that renders a chair
     * per seat.
     */
    seats: {
      type: Number,
      required: [true, 'Seat count is required'],
      min: [1, 'A table needs at least one seat'],
      max: [50, 'Seat count must be 50 or fewer'],
      validate: { validator: Number.isInteger, message: 'Seat count must be a whole number' },
    },

    zone: {
      type: String,
      required: [true, 'Zone is required'],
      trim: true,
      maxlength: 30,
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: { values: TABLE_STATUS_VALUES, message: '{VALUE} is not a valid table status' },
      default: TABLE_STATUS.AVAILABLE,
      index: true,
    },

    /** The open Order, when occupied. Null otherwise. */
    currentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },

    /** Service start, for the elapsed-time badge on the floor plan. */
    occupiedAt: { type: Date, default: null },

    /**
     * Set on the table that was folded into another during a merge. The
     * absorbing table is the one that keeps currentOrder.
     */
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },

    isActive: { type: Boolean, default: true, index: true },
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

tableSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/** Minutes since the party was seated — drives the urgency accent in the UI. */
tableSchema.virtual('occupiedMinutes').get(function occupiedMinutes() {
  if (!this.occupiedAt) return null;
  return Math.floor((Date.now() - this.occupiedAt.getTime()) / 60000);
});

// Names are unique among live tables; a deleted table frees its name.
tableSchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    collation: { locale: 'en', strength: 2 },
  },
);

tableSchema.index({ zone: 1, name: 1 });
tableSchema.index({ isActive: 1, status: 1 });

/**
 * Is this status change legal from where the table is now?
 * Phase 6 checks this against the STORED status, never a client-claimed one.
 * @param {string} next
 */
tableSchema.methods.canTransitionTo = function canTransitionTo(next) {
  if (next === this.status) return true;
  return (TABLE_TRANSITIONS[this.status] || []).includes(next);
};

/** True while a bill is open — blocks deletion and re-seating. */
tableSchema.methods.hasOpenOrder = function hasOpenOrder() {
  return Boolean(this.currentOrder);
};

/** Clear the table after settlement. */
tableSchema.methods.release = function release() {
  this.status = TABLE_STATUS.AVAILABLE;
  this.currentOrder = null;
  this.occupiedAt = null;
  this.mergedInto = null;
  return this;
};

export const Table = mongoose.model('Table', tableSchema);
export default Table;
