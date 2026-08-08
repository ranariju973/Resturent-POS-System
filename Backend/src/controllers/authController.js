/**
 * Authentication handlers.
 *
 * Cross-cutting rules applied throughout:
 *
 *   • Every failed login returns the SAME message and status, whether the
 *     account is unknown, the password is wrong, or the account is disabled.
 *     Distinguishing them turns the login form into an account enumerator.
 *   • Failed logins take roughly the same time whether or not the account
 *     exists, so response latency cannot be used as an oracle either.
 *   • The refresh token never appears in a response body. It is set as an
 *     httpOnly cookie and nowhere else.
 *   • Nothing here logs a password or a PIN, successful or not.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, MAX_FAILED_ATTEMPTS, BCRYPT_COST } from '../models/User.js';
import { RefreshToken, hashToken } from '../models/RefreshToken.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { publicUser } from '../utils/publicUser.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshCookieOptions,
  clearRefreshCookieOptions,
  REFRESH_COOKIE,
} from '../utils/jwt.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

/** One message for every failure mode. Do not make this more specific. */
const GENERIC_LOGIN_FAILURE = 'Invalid credentials';
const LOCKED_MESSAGE = 'Too many failed attempts — try again later';

/**
 * A real bcrypt hash of a value nobody knows, compared against when no account
 * matched. Without it, an unknown email returns in ~1ms and a known one in
 * ~250ms, and that gap alone reveals which addresses are registered.
 * Computed once at startup.
 */
const decoyHashPromise = bcrypt.hash(
  `decoy-${Math.random()}-${Date.now()}`,
  BCRYPT_COST,
);

async function burnTiming(candidate) {
  try {
    await bcrypt.compare(String(candidate ?? ''), await decoyHashPromise);
  } catch {
    /* the comparison's result is irrelevant — only its duration matters */
  }
}

/**
 * Issue an access/refresh pair, persist the refresh record and set the cookie.
 * @param {import('express').Response} res
 * @param {object} user
 * @param {import('express').Request} req
 * @param {any} [family] existing family id when rotating; a new one on login
 */
async function issueSession(res, user, req, family) {
  const sessionFamily = family ?? new mongoose.Types.ObjectId();

  const accessToken = signAccessToken({
    id: user._id,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
  });

  const refresh = signRefreshToken(
    { id: user._id, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    { family: sessionFamily },
  );

  await RefreshToken.issue({
    jti: refresh.jti,
    token: refresh.token,
    userId: user._id,
    family: sessionFamily,
    expiresAt: refresh.expiresAt,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? '',
  });

  res.cookie(REFRESH_COOKIE, refresh.token, refreshCookieOptions(refresh.expiresAt));

  return { accessToken, jti: refresh.jti, family: sessionFamily };
}

/** Shared tail of a successful login. */
async function completeLogin(req, res, user) {
  await user.registerSuccessfulLogin();
  const { accessToken } = await issueSession(res, user, req);

  await AuditLog.record(
    {
      actor: user._id,
      actorName: user.name,
      actorRole: user.role,
      action: AUDIT_ACTION.LOGIN_SUCCESS,
      resource: 'User',
      resourceId: user._id,
      meta: { method: user.email ? 'password' : 'pin' },
    },
    req,
  );

  logger.info('Login succeeded', {
    requestId: req.id,
    userId: String(user._id),
    role: user.role,
  });

  // lastLoginAt was just written by registerSuccessfulLogin; reflect it.
  user.lastLoginAt = new Date();

  return sendSuccess(res, { accessToken, user: publicUser(user) });
}

/** Log and audit a failure without ever recording the attempted secret. */
async function recordFailure(req, { userId = null, reason, identifier }) {
  await AuditLog.record(
    {
      actor: userId,
      action: AUDIT_ACTION.LOGIN_FAILURE,
      resource: 'User',
      resourceId: userId,
      // `identifier` is an email or the string 'pin' — never the PIN itself.
      meta: { reason, identifier },
    },
    req,
  );

  logger.warn('Login failed', { requestId: req.id, reason, ip: req.ip });
}

// ---------------------------------------------------------------------------
// POST /api/auth/login/admin
// ---------------------------------------------------------------------------
export const loginAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findActiveAdminByEmail(email);

  if (!user) {
    await burnTiming(password);
    await recordFailure(req, { reason: 'unknown-account', identifier: email });
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  if (user.isLocked) {
    await recordFailure(req, { userId: user._id, reason: 'locked', identifier: email });
    throw ApiError.tooManyRequests(LOCKED_MESSAGE);
  }

  const ok = await user.verifyPassword(password);

  if (!ok) {
    const nowLocked = await user.registerFailedLogin();
    await recordFailure(req, {
      userId: user._id,
      reason: 'bad-password',
      identifier: email,
    });

    if (nowLocked) {
      await AuditLog.record(
        {
          actor: user._id,
          actorName: user.name,
          actorRole: user.role,
          action: AUDIT_ACTION.ACCOUNT_LOCKED,
          resource: 'User',
          resourceId: user._id,
          meta: { after: MAX_FAILED_ATTEMPTS },
        },
        req,
      );
    }

    // Still the generic message — the client is not told it is now locked,
    // which would confirm the account exists.
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  return completeLogin(req, res, user);
});

// ---------------------------------------------------------------------------
// POST /api/auth/login/staff
// ---------------------------------------------------------------------------
export const loginStaff = asyncHandler(async (req, res) => {
  const { pin } = req.body;

  // One indexed lookup via the peppered lookup hash — see User.js for why
  // this is not a scan over every staff row.
  const user = await User.findActiveByPin(pin);

  if (!user) {
    await burnTiming(pin);
    await recordFailure(req, { reason: 'unknown-pin', identifier: 'pin' });
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  if (user.isLocked) {
    await recordFailure(req, { userId: user._id, reason: 'locked', identifier: 'pin' });
    throw ApiError.tooManyRequests(LOCKED_MESSAGE);
  }

  // The lookup hash only narrowed the candidate. bcrypt is what authenticates.
  const ok = await user.verifyPin(pin);

  if (!ok) {
    const nowLocked = await user.registerFailedLogin();
    await recordFailure(req, { userId: user._id, reason: 'bad-pin', identifier: 'pin' });

    if (nowLocked) {
      await AuditLog.record(
        {
          actor: user._id,
          actorName: user.name,
          actorRole: user.role,
          action: AUDIT_ACTION.ACCOUNT_LOCKED,
          resource: 'User',
          resourceId: user._id,
          meta: { after: MAX_FAILED_ATTEMPTS },
        },
        req,
      );
    }

    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  return completeLogin(req, res, user);
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
/**
 * Rotate the refresh token.
 *
 * The reuse branch below is the important part. A refresh token is single-use;
 * presenting one that was already rotated means the session is compromised,
 * and there is no way to tell the thief from the victim. Both lose the
 * session. That is the correct outcome.
 */
export const refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw ApiError.unauthorized();

  let payload;
  try {
    payload = verifyRefreshToken(raw);
  } catch {
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
    throw ApiError.unauthorized();
  }

  const stored = await RefreshToken.findOne({ jti: payload.jti });

  // Signed correctly but not on file: the record was pruned, or the token was
  // minted against a database that has since been reset.
  if (!stored) {
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
    throw ApiError.unauthorized();
  }

  // --- Reuse detection ---
  if (stored.revokedAt) {
    await RefreshToken.revokeFamily(stored.family, 'reuse-detected');
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());

    logger.error('Refresh token reuse detected — session family revoked', {
      requestId: req.id,
      userId: String(stored.user),
      family: String(stored.family),
      ip: req.ip,
    });

    await AuditLog.record(
      {
        actor: stored.user,
        action: AUDIT_ACTION.LOGIN_FAILURE,
        resource: 'RefreshToken',
        resourceId: stored._id,
        meta: { reason: 'refresh-token-reuse', family: String(stored.family) },
      },
      req,
    );

    throw ApiError.unauthorized();
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
    throw ApiError.unauthorized();
  }

  // Defence in depth: the jti matched, but confirm the presented token really
  // hashes to the stored value.
  if (stored.tokenHash !== hashToken(raw)) {
    await RefreshToken.revokeFamily(stored.family, 'hash-mismatch');
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
    logger.error('Refresh token hash mismatch', {
      requestId: req.id,
      userId: String(stored.user),
    });
    throw ApiError.unauthorized();
  }

  const user = await User.findById(stored.user).select('+tokenVersion');

  if (!user || !user.isActive || (payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    await RefreshToken.revokeFamily(stored.family, 'user-invalid');
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
    throw ApiError.unauthorized();
  }

  // Rotate: issue the replacement inside the same family, then retire this one.
  const { accessToken, jti } = await issueSession(res, user, req, stored.family);

  stored.revokedAt = new Date();
  stored.revokedReason = 'rotated';
  stored.replacedBy = jti;
  await stored.save();

  return sendSuccess(res, { accessToken, user: publicUser(user) });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
/**
 * Revoke server-side, then clear the cookie.
 *
 * Clearing the cookie alone would be theatre: anyone who copied the token
 * before logout could keep using it for the rest of its 7 days. The revoke is
 * what actually ends the session.
 *
 * Always returns 204, even with no cookie or an invalid one — logging out is
 * not a probe worth answering differently.
 */
export const logout = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  const allDevices = req.body?.allDevices === true;

  if (raw) {
    try {
      const payload = verifyRefreshToken(raw);
      const stored = await RefreshToken.findOne({ jti: payload.jti });

      if (stored) {
        if (allDevices) {
          await RefreshToken.revokeAllForUser(stored.user, 'logout-all');
          // Bumping tokenVersion also kills every outstanding ACCESS token,
          // which the refresh records cannot reach on their own.
          const user = await User.findById(stored.user);
          if (user) await user.revokeTokens();
        } else {
          await RefreshToken.revokeFamily(stored.family, 'logout');
        }

        await AuditLog.record(
          {
            actor: stored.user,
            action: AUDIT_ACTION.LOGOUT,
            resource: 'User',
            resourceId: stored.user,
            meta: { allDevices },
          },
          req,
        );
      }
    } catch {
      // An unparseable cookie still results in a clean 204.
    }
  }

  res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
  return res.status(204).end();
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
export const me = asyncHandler(async (req, res) =>
  sendSuccess(res, { user: publicUser(req.authUser) }),
);

export default { loginAdmin, loginStaff, refresh, logout, me };
