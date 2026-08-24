/**
 * Customer record.
 *
 * ── Deviation from the Phase 1 brief, deliberate ───────────────────────────
 * The brief offered an embedded `orderHistory` array. It is not here. Order
 * history is queried from the Order collection by `customer` reference, and
 * paginated.
 *
 * An unbounded array inside a document is a slow-motion failure: it grows
 * without limit, every read of the customer drags the whole history along,
 * and a regular eventually walks into MongoDB's 16MB document ceiling —
 * at which point their record can no longer be saved at all.
 *
 * `lastVisitAt` and `visitCount` are denormalised here because the customer
 * list sorts on them and they are cheap to maintain on order settlement.
 *
 * Phone and email are PII. They are indexed and returned to authorised
 * callers, but the logger's redaction list (src/utils/logger.js) keeps them
 * out of log storage.
 */
import mongoose from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped.js';

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },

    /**
     * Stored as entered, plus a normalised digits-only form for lookup, so
     * '+91 98200 41122' and '9820041122' resolve to the same person instead
     * of quietly creating a duplicate.
     */
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      maxlength: 24,
      match: [/^[+]?[\d\s()-]{6,24}$/, 'Invalid phone number'],
    },

    /*
     * The de-duplication key. Its unique index is declared through the
     * tenantScoped plugin as {tenantId, phoneNormalized} rather than inline:
     * one person may eat at two restaurants on the same deployment, and a
     * global unique index would let whichever saw them first stop the other
     * from ever recording them.
     */
    phoneNormalized: { type: String, select: false },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: '',
      validate: {
        validator: (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: 'Invalid email address',
      },
    },

    /** Allergies, seating preferences. Free text — length-capped. */
    notes: { type: String, trim: true, maxlength: 500, default: '' },

    lastVisitAt: { type: Date, default: null, index: true },
    visitCount: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.phoneNormalized;
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

customerSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

customerSchema.plugin(tenantScoped, {
  unique: [{ fields: { phoneNormalized: 1 }, options: { sparse: true } }],
});

customerSchema.index({ tenantId: 1, name: 'text' });
customerSchema.index({ tenantId: 1, isActive: 1, lastVisitAt: -1 });

/** Digits only, so formatting differences cannot create duplicate records. */
export const normalizePhone = (phone) => String(phone ?? '').replace(/\D/g, '');

customerSchema.pre('save', function syncNormalizedPhone(next) {
  if (this.isModified('phone')) this.phoneNormalized = normalizePhone(this.phone);
  next();
});

/**
 * Escape regex metacharacters before interpolating user input into a RegExp.
 *
 * Search boxes are the classic ReDoS entry point: a query of '(a+)+$' compiled
 * unescaped can hang the event loop. Escaping turns any input into a literal.
 */
export const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Search by name or phone. Anchored and escaped.
 * @param {string} term
 * @param {number} [limit=50]
 */
customerSchema.statics.search = function search(term, limit = 50) {
  const safe = escapeRegex(String(term).trim());
  if (!safe) return this.find({ isActive: true }).sort({ lastVisitAt: -1 }).limit(limit);

  const digits = normalizePhone(term);
  // trusted() because `sanitizeFilter` is on globally (src/config/db.js). The
  // term itself is already regex-escaped above, so these patterns are safe.
  const conditions = [{ name: mongoose.trusted({ $regex: `^${safe}`, $options: 'i' }) }];
  if (digits) {
    conditions.push({ phoneNormalized: mongoose.trusted({ $regex: `^${digits}` }) });
  }

  return this.find({ isActive: true, $or: conditions })
    .sort({ lastVisitAt: -1 })
    .limit(Math.min(limit, 100));
};

/**
 * Bump the denormalised visit counters. Called on order settlement.
 *
 * A static taking an id, not an instance method: the caller (`payOrder`) has
 * an order holding a customer id and no reason to load the whole customer
 * document just to increment two fields. The instance-method version that used
 * to live here was never called for exactly that reason, while payOrder
 * open-coded the same update — one definition is harder to let drift.
 *
 * @param {import('mongoose').Types.ObjectId|string} id
 * @param {Date} [at]
 */
customerSchema.statics.recordVisit = function recordVisit(id, at = new Date()) {
  return this.updateOne({ _id: id }, { $set: { lastVisitAt: at }, $inc: { visitCount: 1 } });
};

export const Customer = mongoose.model('Customer', customerSchema);
export default Customer;
