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

/**
 * Pull a bearer token out of the Authorization header.
 * Returns null rather than throwing on a malformed header — a missing and a
 * malformed token get the same generic 401 either way.
 */
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

      const user = await User.findById(payload.sub).select('+tokenVersion');

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

      req.user = {
        id: String(user._id),
        // From the database, NOT from payload.role.
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        tokenVersion: user.tokenVersion ?? 0,
      };
      req.authUser = user;

      return next();
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
      const user = await User.findById(payload.sub).select('+tokenVersion');

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
