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
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import {
  ORDER_TYPE_VALUES,
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  DISCOUNT_TYPE,
  DISCOUNT_TYPE_VALUES,
} from '../constants/enums.js';
import { minorField, lineTotalMinor, percentOf, sumMinor } from '../utils/money.js';
import { tenantScoped } from './plugins/tenantScoped.js';

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
    /**
     * Human-facing number from the daily sequence. Resets each service day, so
     * it is NOT unique across days — yesterday's #41 and today's #41 both
     * exist. Use `invoiceNo` when a value has to address one specific bill.
     */
    orderNo: { type: Number, required: true, index: true },

    /**
     * ── The customer-facing invoice ────────────────────────────────────────
     * `INV-20260806-0041`. Assigned at creation and unique for all time, which
     * is what `orderNo` cannot be. Null on orders that predate the feature.
     */
    invoiceNo: { type: String, default: null },

    /**
     * SHA-256 of the invoice link's secret token, peppered from the
     * environment. Minted at PAYMENT, so an unpaid or voided-before-payment
     * bill has no shareable link at all.
     *
     * The raw token is never stored. It lives in the URL the customer keeps —
     * a bearer credential — so a raw column would turn any database leak into
     * every invoice this restaurant has ever issued, names and phones
     * included. Same reasoning as User.pinHash.
     *
     * `select: false` so no ordinary Order.find() in reports or dashboards can
     * ship it by accident.
     */
    invoiceTokenHash: { type: String, default: null, select: false },

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

/*
 * Every unique constraint below is declared through the plugin so it is scoped
 * per restaurant. invoiceTokenHash is the deliberate exception — see its note.
 */
orderSchema.plugin(tenantScoped, {
  unique: [
    /*
     * Sparse because every order predating this feature has null, and a plain
     * unique index would reject the second one. Unique because the invoice
     * number is what a customer, a receipt and a support query all point at.
     *
     * Per-restaurant: order numbers restart at 1 each service day FOR EACH
     * restaurant (see Counter.js), so two venues both issue INV-20260806-0001
     * on the same day. A global index would let the first one written take the
     * number and reject the second restaurant's genuine order.
     */
    { fields: { invoiceNo: 1 }, options: { sparse: true } },

    /*
     * One open order per table at a time — enforced by the database, not by a
     * check-then-write in a controller that two requests can interleave
     * through.
     */
    {
      fields: { table: 1 },
      options: {
        partialFilterExpression: { status: ORDER_STATUS.OPEN, table: { $type: 'objectId' } },
      },
    },
  ],
});

// Dashboard and reports both scan by status over a date window.
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
/**
 * Every revenue figure in reportController and dashboardController matches
 * { status: 'paid', paidAt: { $gte, $lt } } — takings, P&L, byHour, topItems.
 * The index above has the right leading field but the wrong sort key, so
 * without this one those queries seek on status and then filter the date range
 * in memory, reading every paid order ever taken to answer "today".
 */
orderSchema.index({ tenantId: 1, status: 1, paidAt: -1 });
// Multikey index over the line items, so "has this menu item ever been
// ordered?" is a lookup rather than a scan of every order ever taken. The
// purge check depends on it; without it that check gets slower every service.
orderSchema.index({ tenantId: 1, 'items.menuItem': 1 });
orderSchema.index({ tenantId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, createdBy: 1, createdAt: -1 });

/**
 * The public lookup key, and the ONE index here that stays GLOBAL.
 *
 * A customer opening a receipt link has no session and no tenant — the 192-bit
 * token in the URL is what identifies both the order and the restaurant it
 * belongs to. Scoping this per tenant would require knowing the tenant before
 * the lookup, which is precisely what the lookup is for.
 *
 * Safe to keep global because the value is 192 bits of CSPRNG output hashed
 * with a server-side pepper: it is unguessable, so uniqueness across the whole
 * deployment costs nothing and collisions are not a practical concern. The
 * controller re-enters the resolved tenant immediately afterwards.
 */
orderSchema.index({ invoiceTokenHash: 1 }, { unique: true, sparse: true });

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

/**
 * Format the customer-facing invoice number.
 *
 * `day` MUST be the string the counter was keyed on — see
 * nextSequenceWithDay in Counter.js for why re-reading the clock here is a
 * once-a-year bug rather than a style preference.
 *
 * @param {string} day 'YYYY-MM-DD'
 * @param {number} seq
 */
export const formatInvoiceNo = (day, seq) =>
  `INV-${day.replaceAll('-', '')}-${String(seq).padStart(4, '0')}`;

/** A fresh link secret. 192 bits — far past anything worth guessing at. */
export const mintInvoiceToken = () => randomBytes(24).toString('base64url');

/**
 * Hash a link token for storage and lookup.
 *
 * Deterministic SHA-256, NOT bcrypt — and the difference matters. bcrypt salts
 * randomly, so you cannot look a value up by its hash; every public request
 * would have to scan the orders collection and compare one by one, which is
 * both slow and a free denial-of-service. A fast hash is the right choice
 * *here*, where it would be wrong for a PIN, because the input is 192 bits of
 * randomness with no dictionary to grind against.
 *
 * The pepper means a stolen database alone cannot be reversed even if the
 * token were ever shortened.
 */
export const hashInvoiceToken = (token) =>
  createHash('sha256').update(`${token}${env.INVOICE_TOKEN_PEPPER}`).digest('hex');

export const Order = mongoose.model('Order', orderSchema);
export default Order;
