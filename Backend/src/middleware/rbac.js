/**
 * Role-based access control.
 *
 * Usage — always after requireAuth(), never instead of it:
 *
 *   router.patch(
 *     '/items/:id/availability',
 *     requireAuth(),
 *     requirePermission(PERMISSIONS.MENU_TOGGLE_STOCK),
 *     handler,
 *   );
 *
 * ── What the client is told ────────────────────────────────────────────────
 * A denial returns a bare 403 with "Insufficient permissions" — never the name
 * of the permission required, never the caller's role, never a hint about what
 * would have worked. Detailed authorisation errors are a map of the system's
 * internals, drawn for whoever is probing it. The detail goes to the server
 * log and the audit trail, where it is actually useful.
 *
 * ── Reads are guarded too ──────────────────────────────────────────────────
 * There is no "it's only a GET" exemption. A cashier fetching /api/reports
 * reads the restaurant's margins just as effectively as an admin does. Every
 * route that touches data carries a permission, including read-only ones.
 */
import { hasPermission, hasAnyPermission, hasAllPermissions } from '../constants/permissions.js';
import { ApiError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

/** One message for every denial. Do not make this more specific. */
const DENIED = 'Insufficient permissions';

/**
 * Log and audit a denial with the detail the client is not given.
 * Fire-and-forget: an audit write must never block or fail the response.
 */
function recordDenial(req, required) {
  logger.warn('Authorisation denied', {
    requestId: req.id,
    userId: req.user?.id,
    role: req.user?.role,
    required,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
}

/**
 * Guard against a route that was wired without requireAuth().
 *
 * Without this the middleware would read `req.user?.role` as undefined,
 * hasPermission would return false, and the route would 403 — which looks
 * like working authorisation while actually being a misconfiguration. Failing
 * loudly with a 500 in that case makes the wiring bug obvious in development
 * instead of shipping as a permanently-broken endpoint.
 */
function assertAuthenticated(req) {
  if (req.user?.role) return null;

  logger.error('requirePermission used without requireAuth — route is misconfigured', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
  });
  return ApiError.internal();
}

/**
 * Require a single permission.
 *
 * @param {string} permission from PERMISSIONS
 * @returns {import('express').RequestHandler}
 */
export function requirePermission(permission) {
  if (!permission || typeof permission !== 'string') {
    // Thrown at module load, not per request — a typo'd permission name is a
    // programming error and should stop the server from starting.
    throw new Error('requirePermission() needs a permission string');
  }

  return (req, _res, next) => {
    const misconfigured = assertAuthenticated(req);
    if (misconfigured) return next(misconfigured);

    if (!hasPermission(req.user.role, permission)) {
      recordDenial(req, permission);
      return next(ApiError.forbidden(DENIED));
    }
    return next();
  };
}

/**
 * Require at least one of several permissions.
 * For routes serving more than one audience — a dashboard endpoint reachable
 * with either the full or the limited grant, then shaped per role inside.
 *
 * @param {string[]} permissions
 */
export function requireAnyPermission(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new Error('requireAnyPermission() needs a non-empty array');
  }

  return (req, _res, next) => {
    const misconfigured = assertAuthenticated(req);
    if (misconfigured) return next(misconfigured);

    if (!hasAnyPermission(req.user.role, permissions)) {
      recordDenial(req, permissions.join(' | '));
      return next(ApiError.forbidden(DENIED));
    }
    return next();
  };
}

/** Require every listed permission. */
export function requireAllPermissions(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new Error('requireAllPermissions() needs a non-empty array');
  }

  return (req, _res, next) => {
    const misconfigured = assertAuthenticated(req);
    if (misconfigured) return next(misconfigured);

    if (!hasAllPermissions(req.user.role, permissions)) {
      recordDenial(req, permissions.join(' + '));
      return next(ApiError.forbidden(DENIED));
    }
    return next();
  };
}

/**
 * In-handler check, for branching rather than gating.
 *
 * Some rules are not "may you call this route" but "how much may you do once
 * inside it" — a discount above the cashier ceiling needing `pos:override`, or
 * the dashboard returning a smaller payload. Use this for those; use the
 * middleware for everything else.
 *
 * @example
 *   if (discountPct > CASHIER_MAX && !can(req, PERMISSIONS.POS_OVERRIDE)) {
 *     throw ApiError.forbidden('Discount requires manager approval');
 *   }
 */
export function can(req, permission) {
  return hasPermission(req.user?.role, permission);
}

/**
 * Throw unless the caller holds the permission. The in-handler twin of
 * requirePermission, for checks that only become relevant partway through.
 *
 * @param {import('express').Request} req
 * @param {string} permission
 * @param {string} [message] shown to the client — keep it about the ACTION,
 *        not the permission, e.g. "Discount requires manager approval"
 */
export function assertCan(req, permission, message = DENIED) {
  if (!can(req, permission)) {
    recordDenial(req, permission);
    throw ApiError.forbidden(message);
  }
}

export default { requirePermission, requireAnyPermission, requireAllPermissions, can, assertCan };
