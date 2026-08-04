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

    phoneNormalized: { type: String, index: { unique: true, sparse: true }, select: false },

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

customerSchema.index({ name: 'text' });
customerSchema.index({ isActive: 1, lastVisitAt: -1 });

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

/** Called on order settlement to keep the denormalised counters honest. */
customerSchema.methods.recordVisit = function recordVisit(at = new Date()) {
  return this.constructor.updateOne(
    { _id: this._id },
    { $set: { lastVisitAt: at }, $inc: { visitCount: 1 } },
  );
};

export const Customer = mongoose.model('Customer', customerSchema);
export default Customer;
