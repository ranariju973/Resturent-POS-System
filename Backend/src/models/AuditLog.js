/**
 * Append-only audit trail. Written from Phase 11 onward.
 *
 * Records WHO did WHAT to WHICH record, and never the sensitive value itself:
 * a failed login logs the attempt, not the PIN that was tried. The `meta`
 * field is free-form, so it passes through the same redaction list the logger
 * uses before anything is written.
 *
 * Documents are immutable once written — the schema blocks updates. An audit
 * log that can be edited by the same account it is auditing is not evidence
 * of anything.
 */
import mongoose from 'mongoose';
import { AUDIT_ACTION_VALUES } from '../constants/enums.js';

/** Never persist these, whatever a caller passes in `meta`. */
const REDACTED_META_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'pin',
  'pinhash',
  'adminoverride',
  'adminoverridepin',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
]);

const auditLogSchema = new mongoose.Schema(
  {
    /** Null for a failed login where no account could be resolved. */
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /** Denormalised so the entry stays readable if the account is later removed. */
    actorName: { type: String, trim: true, maxlength: 80, default: '' },
    actorRole: { type: String, trim: true, maxlength: 30, default: '' },

    action: {
      type: String,
      required: true,
      enum: { values: AUDIT_ACTION_VALUES, message: '{VALUE} is not a known audit action' },
      index: true,
    },

    /** Collection name — 'Order', 'MenuItem', 'Table'. */
    resource: { type: String, trim: true, maxlength: 40, default: '' },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    /** Context: old/new price, void reason, order number. Redacted on write. */
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, trim: true, maxlength: 64, default: '' },
    userAgent: { type: String, trim: true, maxlength: 300, default: '' },
    requestId: { type: String, trim: true, maxlength: 64, default: '' },

    at: { type: Date, required: true, default: Date.now, index: true },
  },
  {
    versionKey: false,
    // Entries are never edited, so there is nothing for updatedAt to record.
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

auditLogSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

// The admin audit view: filter by actor or action over a date range.
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ actor: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

function redactMeta(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactMeta(v, seen));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACTED_META_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactMeta(v, seen);
  }
  return out;
}

auditLogSchema.pre('save', function scrubMeta(next) {
  if (this.meta && typeof this.meta === 'object') this.meta = redactMeta(this.meta);
  next();
});

// Immutability: block every update path at the model level. Correcting a bad
// entry means writing a new one, which is the point.
const blockUpdate = function blockUpdate(next) {
  next(new Error('Audit log entries are immutable'));
};
auditLogSchema.pre('updateOne', blockUpdate);
auditLogSchema.pre('updateMany', blockUpdate);
auditLogSchema.pre('findOneAndUpdate', blockUpdate);

/**
 * Write an entry. Never throws into the caller — a failed audit write must
 * not take down the operation being audited, but it must be loud in the logs.
 *
 * @param {object} entry
 * @param {import('express').Request} [req] pulls ip / userAgent / requestId / actor
 */
auditLogSchema.statics.record = async function record(entry, req) {
  try {
    const doc = new this({
      ...entry,
      actor: entry.actor ?? req?.user?.id ?? null,
      actorName: entry.actorName ?? req?.user?.name ?? '',
      actorRole: entry.actorRole ?? req?.user?.role ?? '',
      ip: entry.ip ?? req?.ip ?? '',
      userAgent: entry.userAgent ?? req?.get?.('user-agent')?.slice(0, 300) ?? '',
      requestId: entry.requestId ?? req?.id ?? '',
      at: entry.at ?? new Date(),
    });
    await doc.save();
    return doc;
  } catch (err) {
    const { logger } = await import('../utils/logger.js');
    logger.error('Failed to write audit log entry', {
      action: entry?.action,
      message: err.message,
    });
    return null;
  }
};

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
