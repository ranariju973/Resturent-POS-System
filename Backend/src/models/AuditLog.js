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
import { tenantScoped } from './plugins/tenantScoped.js';

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

    // No `index: true` here. It would create a plain `at_1`, and the TTL
    // index declared below needs that exact name WITH expireAfterSeconds —
    // MongoDB refuses to change an existing index's options in place, so the
    // two declarations collide and the sync fails.
    at: { type: Date, required: true, default: Date.now },
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

/*
 * `required: false`, unlike every other scoped model.
 *
 * Most audit entries belong to a restaurant and are stamped automatically. A
 * few genuinely do not: a failed sign-in where no account could be resolved,
 * and the actions of a Google user who has authenticated but not yet named a
 * restaurant. Those are exactly the events an audit trail must not drop, so
 * the field is optional here and the writer says `tenantId: null` explicitly
 * to reach that path (see record() below).
 */
auditLogSchema.plugin(tenantScoped, { required: false });

// The admin audit view: filter by actor or action over a date range.
auditLogSchema.index({ tenantId: 1, at: -1 });
auditLogSchema.index({ tenantId: 1, actor: 1, at: -1 });
auditLogSchema.index({ tenantId: 1, action: 1, at: -1 });

/**
 * Ninety-day retention, enforced by the database.
 *
 * Nothing here was ever deleted, and every order, void, refund and failed
 * sign-in writes a row — so the collection grew without bound against a fixed
 * storage quota, taking three indexes with it.
 *
 * Ninety days covers the window in which a disputed bill or a staff question
 * actually gets raised. MongoDB removes anything older on its own schedule
 * (it sweeps about once a minute), so there is no cleanup job to schedule and
 * nothing to forget.
 *
 * NOTE: this is a retention POLICY, not a storage trick. Lengthening it later
 * is safe; shortening it destroys history that is already gone by then.
 *
 * ── Do not add tenantId to this one ────────────────────────────────────────
 * Every other index in this file gained a tenantId prefix. This one must not:
 * expireAfterSeconds is only valid on a SINGLE-FIELD index, and MongoDB
 * rejects a compound one outright —
 *   "TTL indexes are single-field indexes, compound indexes do not support TTL"
 * — so making this {tenantId, at} for consistency would fail the index sync
 * and, with it, the boot. Retention is a deployment-wide policy anyway, not a
 * per-restaurant one.
 */
const AUDIT_RETENTION_DAYS = 90;
auditLogSchema.index({ at: 1 }, { expireAfterSeconds: AUDIT_RETENTION_DAYS * 24 * 60 * 60 });

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
 * Pass the session when recording something that happened inside a
 * transaction. Without it the entry commits independently, so a transaction
 * that later aborts leaves an audit row describing a write that was rolled
 * back — a customer created for an order that never existed, for instance.
 * The audit trail then disagrees with the data it is supposed to explain.
 *
 * @param {object} entry
 * @param {import('express').Request} [req] pulls ip / userAgent / requestId / actor
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 */
auditLogSchema.statics.record = async function record(entry, req, options = {}) {
  try {
    /*
     * Some entries are written with no restaurant in context, and that is
     * correct rather than a gap: a failed sign-in, or a Google user who has
     * not yet named a restaurant, genuinely belongs to none. The plugin would
     * refuse such a write, so those callers pass `tenantId: null` explicitly
     * and this hands the write to runUnscoped.
     *
     * Only when the caller SAYS so. An entry that merely forgot its context
     * still throws, which is what keeps this from becoming a quiet way to
     * write unscoped rows.
     */
    if (entry.tenantId === null) {
      const { runUnscoped } = await import('../utils/tenantContext.js');
      return runUnscoped('audit entry with no restaurant (pre-onboarding or failed login)',
        async () => {
          const unscoped = new this({
            ...entry,
            tenantId: undefined,
            actor: entry.actor ?? req?.user?.id ?? null,
            actorName: entry.actorName ?? req?.user?.name ?? '',
            actorRole: entry.actorRole ?? req?.user?.role ?? '',
            ip: entry.ip ?? req?.ip ?? '',
            userAgent: entry.userAgent ?? req?.get?.('user-agent')?.slice(0, 300) ?? '',
            requestId: entry.requestId ?? req?.id ?? '',
            at: entry.at ?? new Date(),
          });
          await unscoped.save(options.session ? { session: options.session } : {});
          return unscoped;
        });
    }

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
    await doc.save(options.session ? { session: options.session } : {});
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
