/**
 * Audit-log reader. Admin only.
 *
 * ── What this endpoint deliberately does NOT do ────────────────────────────
 * There is no write, no update and no delete. The model blocks mutation at the
 * schema level too, so even a future controller cannot edit an entry. An audit
 * log that the audited party can amend is not evidence of anything.
 *
 * Reading the log is itself a privileged act, so `audit:view` is separate from
 * `reports:view` — an owner checking margins is doing something different from
 * an owner checking who voided last Tuesday's bills.
 */
import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { sendSuccess, asyncHandler } from '../utils/apiResponse.js';

const dayStart = (iso) => new Date(`${iso}T00:00:00`);
const dayEnd = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
};

export const listAuditLogs = asyncHandler(async (req, res) => {
  const { actor, action, resource, from, to, limit, skip } = req.query;

  const filter = {};
  if (actor) filter.actor = actor;
  if (action) filter.action = action;
  if (resource) filter.resource = resource;

  if (from || to) {
    filter.at = mongoose.trusted({
      ...(from ? { $gte: dayStart(from) } : {}),
      ...(to ? { $lt: dayEnd(to) } : {}),
    });
  }

  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    entries: entries.map((e) => ({
      id: String(e._id),
      at: e.at,
      action: e.action,
      actor: e.actor ? String(e.actor) : null,
      actorName: e.actorName,
      actorRole: e.actorRole,
      resource: e.resource,
      resourceId: e.resourceId ? String(e.resourceId) : null,
      // Already scrubbed on write by the model's pre-save hook.
      meta: e.meta,
      ip: e.ip,
      requestId: e.requestId,
    })),
    total,
    limit,
    skip,
    hasMore: skip + entries.length < total,
  });
});

/**
 * The actions worth watching, counted over a window.
 *
 * This exists because a raw log is not a control — nobody reads five thousand
 * lines. A count of voids, failed logins and manager overrides is the shape an
 * owner would actually notice something in.
 */
export const auditSummary = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * 864e5);

  const WATCHED = [
    AUDIT_ACTION.ORDER_VOID,
    AUDIT_ACTION.ORDER_DISCOUNT_OVERRIDE,
    AUDIT_ACTION.LOGIN_FAILURE,
    AUDIT_ACTION.ACCOUNT_LOCKED,
    AUDIT_ACTION.MENU_ITEM_PRICE_CHANGE,
    AUDIT_ACTION.CUSTOMER_DELETE,
  ];

  const rows = await AuditLog.aggregate([
    { $match: { at: mongoose.trusted({ $gte: since }), action: mongoose.trusted({ $in: WATCHED }) } },
    { $group: { _id: { action: '$action', actor: '$actorName' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return sendSuccess(res, {
    since,
    // Every watched action present, including zeros — an absent row reads as
    // missing data rather than as "this never happened".
    byAction: WATCHED.map((action) => ({
      action,
      count: rows.filter((r) => r._id.action === action).reduce((s, r) => s + r.count, 0),
      byActor: rows
        .filter((r) => r._id.action === action)
        .map((r) => ({ actor: r._id.actor || 'unknown', count: r.count })),
    })),
  });
});

export default { listAuditLogs, auditSummary };
