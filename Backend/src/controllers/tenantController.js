/**
 * Creating a restaurant — the onboarding step.
 *
 * The only endpoint, besides GET /auth/me, that a session with no restaurant
 * can reach. Everything else refuses it, not by a check written here but
 * because the model plugin declines to run any scoped query without a tenant
 * in context.
 */
import mongoose from 'mongoose';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, ROLES } from '../constants/enums.js';
import { publicUser } from '../utils/publicUser.js';
import { runUnscoped, runInTenant } from '../utils/tenantContext.js';
import { withTransaction } from '../utils/transaction.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { issueSession } from './authController.js';
import { invalidateSettingsCache } from '../models/PrinterSettings.js';

export const publicTenant = (tenant) => ({
  id: String(tenant._id),
  name: tenant.name,
  slug: tenant.slug,
  tagline: tenant.tagline ?? '',
  address: tenant.address ?? '',
  phone: tenant.phone ?? '',
  gstNumber: tenant.gstNumber ?? '',
  footerLine: tenant.footerLine ?? '',
});

// ---------------------------------------------------------------------------
// POST /api/tenants
// ---------------------------------------------------------------------------
/**
 * Name a restaurant, and become its administrator.
 *
 * ── The ordering problem, and how it is resolved ───────────────────────────
 * The restaurant and its first user have to be created together: the user
 * cannot be stamped with a tenant that does not exist, and the tenant's owner
 * cannot point at a user that has not been saved. Minting the tenant's id up
 * front breaks the cycle — the whole transaction then runs inside that id's
 * context, so the user's write is stamped correctly by the ordinary plugin
 * path rather than by a special case.
 */
export const createTenant = asyncHandler(async (req, res) => {
  const { name } = req.body;

  /*
   * Unscoped because this user has no restaurant yet — that is the entire
   * premise of the request.
   */
  const user = await runUnscoped('onboarding: load the account creating a restaurant', async () =>
    User.findById(req.user.id).select('+tokenVersion'));

  if (!user) throw ApiError.unauthorized();

  /*
   * One restaurant per account, refused rather than silently ignored.
   *
   * A second call would otherwise orphan the first restaurant — its owner
   * would move to the new one and nobody would be left holding the old.
   */
  if (user.tenantId) {
    throw ApiError.conflict('This account already belongs to a restaurant');
  }

  const tenantId = new mongoose.Types.ObjectId();
  const slug = await runUnscoped('onboarding: check slug availability', async () =>
    Tenant.generateSlug(name));

  const result = await runInTenant(tenantId, async () =>
    withTransaction(async (session) => {
      const tenant = new Tenant({ _id: tenantId, name, slug, owner: user._id });
      await tenant.save({ session });

      user.tenantId = tenantId;
      user.role = ROLES.ADMIN;
      /*
       * Invalidates the token that brought them here.
       *
       * That token carries an empty restaurant claim, and requireAuth compares
       * the claim against the database on every request — so leaving it valid
       * would mean a session whose token says "no restaurant" while the
       * account says otherwise. Bumping the version retires it, and the fresh
       * pair issued below carries the right claim.
       */
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await user.save({ session });

      return { tenant, user };
    }));

  await AuditLog.record(
    {
      actor: user._id,
      actorName: user.name,
      actorRole: user.role,
      action: AUDIT_ACTION.TENANT_CREATE,
      resource: 'Tenant',
      resourceId: result.tenant._id,
      meta: { name: result.tenant.name, slug: result.tenant.slug },
      tenantId,
    },
    req,
  );

  logger.info('Restaurant created', {
    requestId: req.id,
    tenantId: String(tenantId),
    userId: String(user._id),
  });

  /*
   * A fresh session, because the old one was just revoked.
   *
   * Issued through the same helper every other login uses, so a newly created
   * restaurant's first session is identical in shape and lifetime to every
   * session that follows it — there is no special case to get wrong later.
   */
  const { accessToken } = await issueSession(res, result.user, req);

  return sendSuccess(
    res,
    {
      accessToken,
      user: publicUser(result.user),
      restaurant: publicTenant(result.tenant),
    },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// GET /api/tenants/current
// ---------------------------------------------------------------------------
/** The signed-in user's restaurant, for the settings screen and the receipt header. */
export const getCurrentTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) throw ApiError.notFound('Restaurant not found');
  return sendSuccess(res, { restaurant: publicTenant(tenant) });
});

// ---------------------------------------------------------------------------
// PUT /api/tenants/current
// ---------------------------------------------------------------------------
/** Update the restaurant's identity — what a customer sees on their receipt. */
export const updateCurrentTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByIdAndUpdate(
    req.tenantId,
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!tenant) throw ApiError.notFound('Restaurant not found');

  /*
   * The receipt header is memoised for a minute, and it reads through the
   * tenant. Without this a saved address stays invisible on receipts for up to
   * that long, which looks exactly like the save having failed.
   */
  await invalidateSettingsCache();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.SETTINGS_UPDATE,
      resource: 'Tenant',
      resourceId: tenant._id,
      // Field names only — the audit trail's job here is "who changed the setup".
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { restaurant: publicTenant(tenant) });
});

export default { createTenant, getCurrentTenant, updateCurrentTenant };
