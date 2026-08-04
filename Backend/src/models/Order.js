/**
 * A POS billing transaction.
 *
 * This is the money document, so two rules are enforced by the schema itself
 * rather than left to controllers:
 *
 *   1. PRICE SNAPSHOTS. Each line stores the item's name and price as they
 *      were at the moment of sale. Repricing the menu tomorrow must not
 *      rewrite what a customer was charged today, and a soft-deleted item
 *      must still render on an old receipt.
 *
 *   2. SERVER-COMPUTED TOTALS. recalculate() derives every total from the
 *      lines, and a pre-validate hook refuses to save a document whose totals
 *      do not match its lines. Even if a Phase 7 controller were careless
 *      enough to copy a client-supplied total into the document, the write
 *      fails. The client's only inputs are item ids and quantities.
 */
import mongoose from 'mongoose';
import {
  ORDER_TYPE_VALUES,
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  DISCOUNT_TYPE,
  DISCOUNT_TYPE_VALUES,
} from '../constants/enums.js';
import { minorField, lineTotalMinor, percentOf, sumMinor } from '../utils/money.js';

const orderLineSchema = new mongoose.Schema(
  {
    menuItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true,
    },

    // Snapshots — deliberately duplicated from MenuItem, never re-read from it.
    nameSnapshot: { type: String, required: true, trim: true, maxlength: 80 },
    priceMinorAtSale: minorField(),

    qty: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      max: [999, 'Quantity is implausibly large'],
      validate: { validator: Number.isInteger, message: 'Quantity must be a whole number' },
    },

    // Kitchen note — "no coriander". Free text, so length-capped and escaped
    // at render time.
    note: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { _id: true },
);

/** Line total, derived. Never stored — a stored copy is one more thing to drift. */
orderLineSchema.virtual('lineTotalMinor').get(function lineTotal() {
  return lineTotalMinor(this.priceMinorAtSale, this.qty);
});

const orderSchema = new mongoose.Schema(
  {
    /** Human-facing number from the daily sequence. Unique per service day. */
    orderNo: { type: Number, required: true, index: true },

    type: {
      type: String,
      required: true,
      enum: { values: ORDER_TYPE_VALUES, message: '{VALUE} is not a valid order type' },
      index: true,
    },

    // Null for takeaway and delivery.
    // No `index: true` here — the partial unique index declared below already
    // covers this key. Declaring both makes Mongoose build two indexes on
    // { table: 1 } and warn about the duplicate at boot.
    table: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },

    items: {
      type: [orderLineSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'An order must contain at least one item',
      },
    },

    // --- Money (all minor units, all server-derived) ------------------------
    subtotalMinor: minorField({ default: 0 }),

    discountType: {
      type: String,
      enum: { values: [...DISCOUNT_TYPE_VALUES, null], message: '{VALUE} is not a valid discount type' },
      default: null,
    },
    /** Percent (0-100) when type is 'percent'; minor units when 'fixed'. */
    discountValue: { type: Number, default: 0, min: 0 },
    discountMinor: minorField({ default: 0 }),

    /** Percent, e.g. 5 for 5%. Frontend reserves the row; default is no tax. */
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    taxMinor: minorField({ default: 0 }),

    totalMinor: minorField({ default: 0 }),

    // --- Lifecycle ---------------------------------------------------------
    status: {
      type: String,
      required: true,
      enum: { values: ORDER_STATUS_VALUES, message: '{VALUE} is not a valid order status' },
      default: ORDER_STATUS.OPEN,
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: { values: [...PAYMENT_METHOD_VALUES, null], message: '{VALUE} is not a valid payment method' },
      default: null,
    },
    paidAt: { type: Date, default: null },

    // --- Accountability ----------------------------------------------------
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, trim: true, maxlength: 200, default: '' },

    /**
     * The admin who authorised a discount above the cashier ceiling, or a
     * void by a cashier. Null on ordinary orders. This is the audit trail for
     * the override flow — who approved it, not just that it happened.
     */
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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

orderSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

// Dashboard and reports both scan by status over a date window.
orderSchema.index({ status: 1, createdAt: -1 });
// Multikey index over the line items, so "has this menu item ever been
// ordered?" is a lookup rather than a scan of every order ever taken. The
// purge check depends on it; without it that check gets slower every service.
orderSchema.index({ 'items.menuItem': 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ createdBy: 1, createdAt: -1 });
// One open order per table at a time — enforced by the database, not by a
// check-then-write in a controller that two requests can interleave through.
orderSchema.index(
  { table: 1 },
  {
    unique: true,
    partialFilterExpression: { status: ORDER_STATUS.OPEN, table: { $type: 'objectId' } },
  },
);

/**
 * Recompute every monetary field from the line items.
 * The ONLY sanctioned way to set subtotal / discount / tax / total.
 *
 * Order of operations: discount applies to the subtotal, tax applies to the
 * discounted amount. Rounding happens once per step, in money.js.
 *
 * @returns {this}
 */
orderSchema.methods.recalculate = function recalculate() {
  this.subtotalMinor = sumMinor(
    this.items.map((line) => lineTotalMinor(line.priceMinorAtSale, line.qty)),
  );

  if (this.discountType === DISCOUNT_TYPE.PERCENT) {
    this.discountMinor = percentOf(this.subtotalMinor, this.discountValue || 0);
  } else if (this.discountType === DISCOUNT_TYPE.FIXED) {
    this.discountMinor = Math.round(this.discountValue || 0);
  } else {
    this.discountMinor = 0;
  }

  // A discount can zero a bill but never make it negative.
  this.discountMinor = Math.min(this.discountMinor, this.subtotalMinor);

  const taxable = this.subtotalMinor - this.discountMinor;
  this.taxMinor = this.taxRate > 0 ? percentOf(taxable, this.taxRate) : 0;
  this.totalMinor = taxable + this.taxMinor;

  return this;
};

/**
 * Refuse to persist totals that do not follow from the lines.
 *
 * This is the backstop behind "never trust the client": a tampered total has
 * to survive the controller AND this hook, and it cannot.
 */
orderSchema.pre('validate', function verifyTotals(next) {
  if (!Array.isArray(this.items) || this.items.length === 0) return next();

  const claimed = {
    subtotal: this.subtotalMinor,
    discount: this.discountMinor,
    tax: this.taxMinor,
    total: this.totalMinor,
  };

  // Recompute into the document, then compare against what was there.
  this.recalculate();

  const mismatched =
    claimed.subtotal !== this.subtotalMinor ||
    claimed.discount !== this.discountMinor ||
    claimed.tax !== this.taxMinor ||
    claimed.total !== this.totalMinor;

  // A brand-new document legitimately arrives with zeroed totals, so only
  // treat a mismatch as tampering once values were actually set.
  const wasInitialised = claimed.total !== 0 || claimed.subtotal !== 0;

  if (mismatched && wasInitialised) {
    return next(
      new Error(
        'Order totals do not match its line items — refusing to save. ' +
          'Call order.recalculate() instead of assigning totals directly.',
      ),
    );
  }

  return next();
});

/** Paid orders are immutable except for the void path. */
orderSchema.methods.canBeModified = function canBeModified() {
  return this.status === ORDER_STATUS.OPEN;
};

export const Order = mongoose.model('Order', orderSchema);
export default Order;
