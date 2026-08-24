/**
 * Authentication middleware.
 *
 * ── Why this hits the database on every request ────────────────────────────
 * A JWT is self-contained, so the tempting design is to trust its claims and
 * skip the lookup. This does the lookup anyway, and that is deliberate.
 *
 * The brief's rule is "validate user permissions on the server for every
 * single request". A token minted 14 minutes ago says whatever was true 14
 * minutes ago. In a restaurant that is long enough for a cashier to be
 * demoted, a shift to end, or an account to be disabled after a till
 * discrepancy — and a stale token would keep working until it expired.
 *
 * So the token proves identity; the DATABASE decides authorisation. `req.user.role`
 * is always the stored role, never the token's copy. Phase 3's RBAC layer
 * reads req.user, so this guarantee propagates to every permission check.
 *
 * The cost is one indexed findById per request. For a single restaurant with
 * a handful of terminals that is nothing; the correctness is worth far more.
 */
import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/apiResponse.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';
import { runInTenant } from '../utils/tenantContext.js';
import { rememberUser } from '../utils/userCache.js';

/**
 * Pull a bearer token out of the Authorization header.
 * Returns null rather than throwing on a malformed header — a missing and a
 * malformed token get the same generic 401 either way.
 */
/**
 * The user behind a token, cached for 30 seconds.
 *
 * `.lean()` is not optional here: a Mongoose document is mutable and tracks
 * its own dirty state, so caching one would hand every concurrent request the
 * same mutable object. A plain object cannot be accidentally saved or
 * corrupted by a handler that touches it.
 *
 * The explicit field list replaces `.select('+tokenVersion')`. tokenVersion is
 * select:false, and naming the rest keeps the hashes — passwordHash, pinLookup,
 * overridePinLookup — out of a cache that lives for 30 seconds, which they
 * have no reason to be in.
 *
 * Any write to a User drops this (see the hooks at the bottom of models/User.js),
 * so a deactivation or role change still takes effect on the next request.
 */
function loadUser(id) {
  return rememberUser(id, () =>
    User.findById(id)
      .select('_id name role isActive tokenVersion email avatarUrl lastLoginAt tenantId')
      .lean(),
  );
}

function extractBearer(req) {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Require a valid access token.
 *
 * On success attaches:
 *   req.user  = { id, role, name, isActive, tokenVersion }
 *   req.authUser = the Mongoose document, for handlers that need more
 *
 * Every failure path returns the same 401 with the same message. An attacker
 * probing the endpoint learns nothing about whether the account exists, is
 * disabled, or simply had an expired token.
 *
 * @returns {import('express').RequestHandler}
 */
export function requireAuth() {
  return async (req, _res, next) => {
    try {
      const token = extractBearer(req);
      if (!token) return next(ApiError.unauthorized());

      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        // Deliberately swallowed: expired, malformed and forged all look
        // identical to the client.
        return next(ApiError.unauthorized());
      }

      const user = await loadUser(payload.sub);

      if (!user) {
        logger.warn('Access token references a missing user', {
          requestId: req.id,
          sub: payload.sub,
        });
        return next(ApiError.unauthorized());
      }

      // Deactivated mid-session — the token is still cryptographically valid
      // and must stop working immediately.
      if (!user.isActive) {
        logger.warn('Access attempt by deactivated account', {
          requestId: req.id,
          userId: String(user._id),
        });
        return next(ApiError.unauthorized());
      }

      // Token predates a logout-everywhere, password change or forced revoke.
      if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
        logger.warn('Rejected token with stale version', {
          requestId: req.id,
          userId: String(user._id),
        });
        return next(ApiError.unauthorized());
      }

      /*
       * Which restaurant — from the DATABASE, with the token's claim used only
       * to detect disagreement.
       *
       * Same rule as `role` above, for the same reason: the token proves
       * identity, the database decides authorisation, and belonging to a
       * restaurant is an authorisation fact. The claim is compared rather than
       * trusted so that a token minted before an account was moved between
       * restaurants — or against a database that has since been replaced —
       * fails closed instead of silently re-scoping the session.
       */
      const tokenTenant = payload.tid ?? '';
      const actualTenant = user.tenantId ? String(user.tenantId) : '';
      if (tokenTenant !== actualTenant) {
        logger.warn('Rejected token whose restaurant no longer matches the account', {
          requestId: req.id,
          userId: String(user._id),
        });
        return next(ApiError.unauthorized());
      }

      req.user = {
        id: String(user._id),
        // From the database, NOT from payload.role.
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        tokenVersion: user.tokenVersion ?? 0,
        tenantId: user.tenantId ?? null,
      };
      req.authUser = user;
      /*
       * Null for an account that has authenticated but not yet named a
       * restaurant. withTenantContext refuses to enter a context for it, and
       * every scoped query then throws — which is what limits such a session
       * to the two endpoints onboarding needs.
       */
      req.tenantId = user.tenantId ?? null;

      /*
       * Enter the restaurant here, not in a separate app-level middleware.
       *
       * This looked like it belonged in its own middleware mounted on /api —
       * one line instead of a change to this file. It does not work: Express
       * runs app-level middleware BEFORE a router's own `router.use(...)`, so
       * such a middleware would always run before this handler and would find
       * req.tenantId unset on every request.
       *
       * The tenant becomes known exactly here, so the context is entered
       * exactly here. `next()` is called INSIDE runInTenant, which puts the
       * whole downstream chain — every handler, every await, every query —
       * inside it.
       *
       * An account with no restaurant yet (a Google user mid-onboarding)
       * passes through with no context. Every scoped query then throws, which
       * is precisely what limits that session to the endpoints onboarding
       * needs.
       */
      if (!req.tenantId) return next();
      return runInTenant(req.tenantId, () => next());
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Attach req.user when a valid token is present, but allow the request
 * through when it is not. For endpoints whose response differs for a signed-in
 * user without requiring one. Never use it to guard protected data.
 */
export function optionalAuth() {
  return async (req, _res, next) => {
    const token = extractBearer(req);
    if (!token) return next();

    try {
      const payload = verifyAccessToken(token);
      const user = await loadUser(payload.sub);

      if (user?.isActive && (payload.tv ?? 0) === (user.tokenVersion ?? 0)) {
        req.user = {
          id: String(user._id),
          role: user.role,
          name: user.name,
          isActive: user.isActive,
          tokenVersion: user.tokenVersion ?? 0,
        };
        req.authUser = user;
      }
    } catch {
      // Anonymous is a valid outcome here.
    }
    return next();
  };
}

export default requireAuth;
