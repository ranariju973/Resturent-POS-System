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
import { OAuth2Client } from 'google-auth-library';
import { User, MAX_FAILED_ATTEMPTS, BCRYPT_COST } from '../models/User.js';
import { RefreshToken, hashToken } from '../models/RefreshToken.js';
import { Device } from '../models/Device.js';
import { Tenant } from '../models/Tenant.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, ROLES } from '../constants/enums.js';
import { env } from '../config/env.js';
import { publicUser } from '../utils/publicUser.js';
import { runUnscoped, runInTenant, getTenantId } from '../utils/tenantContext.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshCookieOptions,
  clearRefreshCookieOptions,
  clearDeviceCookieOptions,
  REFRESH_COOKIE,
  DEVICE_COOKIE,
} from '../utils/jwt.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

/**
 * The terminal this browser is linked to — but only if it is OUR terminal.
 *
 * ── The bug this closes ────────────────────────────────────────────────────
 * The device cookie is a one-year binding that deliberately survives logout: a
 * till must not need re-linking every time a cashier's shift ends. On a SHARED
 * browser that becomes a leak between restaurants. Owner A links the machine,
 * signs out; owner B signs in with a different Google account and creates
 * restaurant B — and every "is this terminal linked?" answer still described
 * restaurant A's terminal. B was shown A's restaurant name on the login
 * screen, and was never offered terminal setup, because as far as the client
 * could tell the machine was already linked.
 *
 * So the cookie alone is not an answer to "which terminal is this session's".
 * It is only an answer once it agrees with the session's restaurant. A device
 * belonging to anyone else is reported as absent — not cleared, because the
 * machine may genuinely be restaurant A's till and an owner glancing at a
 * second account must not silently unlink it. Linking a terminal as B
 * overwrites the cookie through the ordinary path.
 *
 * @param {import('express').Request} req
 * @param {import('mongoose').Types.ObjectId|string|null} tenantId the SESSION's
 *   restaurant — not the device's.
 * @returns {Promise<object|null>}
 */
async function ownTerminal(req, tenantId) {
  const deviceToken = req.cookies?.[DEVICE_COOKIE];
  if (!deviceToken || !tenantId) return null;

  // Unscoped for the usual reason: resolving WHICH restaurant a globally
  // unique token names is the whole point. The comparison below is what makes
  // it safe to have looked across tenants at all.
  const device = await runUnscoped('session terminal: device token -> restaurant', async () =>
    Device.findByToken(deviceToken));

  if (!device) return null;
  if (String(device.tenantId) !== String(tenantId)) {
    logger.info('Ignoring a device cookie belonging to another restaurant', {
      requestId: req.id,
      userId: req.user?.id,
    });
    return null;
  }
  return device;
}

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
 *
 * Exported because onboarding needs it: creating a restaurant revokes the
 * token that got the user there, so a fresh session has to be minted through
 * the same path every other login uses.
 * @param {import('express').Response} res
 * @param {object} user
 * @param {import('express').Request} req
 * @param {any} [family] existing family id when rotating; a new one on login
 */
export async function issueSession(res, user, req, family) {
  const sessionFamily = family ?? new mongoose.Types.ObjectId();

  const accessToken = signAccessToken({
    id: user._id,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
    // requireAuth compares this against the database on every request, so an
    // account moved between restaurants invalidates its existing tokens.
    tenantId: user.tenantId ?? null,
  });

  const refresh = signRefreshToken(
    {
      id: user._id,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
      tenantId: user.tenantId ?? null,
    },
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

/**
 * Shared tail of a successful login.
 *
 * @param {object} [context]
 * @param {object} [context.tenant] the restaurant, so the client can label the
 *   screen without a second request
 * @param {object} [context.device] the terminal, on a PIN login
 */
async function completeLogin(req, res, user, { tenant, device } = {}) {
  await user.registerSuccessfulLogin();
  const { accessToken } = await issueSession(res, user, req);

  /*
   * A PIN login already resolved the device — it is how the restaurant was
   * found in the first place. A Google login did not, so look now: an owner
   * signing in needs to know whether THIS machine is their terminal, and it is
   * the answer that decides whether the client offers terminal setup.
   */
  const terminal = device ?? (await ownTerminal(req, user.tenantId));

  await AuditLog.record(
    {
      actor: user._id,
      actorName: user.name,
      actorRole: user.role,
      action: AUDIT_ACTION.LOGIN_SUCCESS,
      resource: 'User',
      resourceId: user._id,
      meta: { method: user.authProvider === 'google' ? 'google' : 'pin' },
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

  return sendSuccess(res, {
    accessToken,
    user: publicUser(user),
    /*
     * The restaurant's name and the terminal's, returned with the session.
     *
     * The till renders both in its header. Sending them here rather than
     * making the client fetch them saves a round trip on every sign-in, and
     * means the labels can never disagree with the session they belong to.
     */
    restaurant: tenant ? { id: String(tenant._id), name: tenant.name, slug: tenant.slug } : null,
    terminal: terminal ? { id: String(terminal._id), name: terminal.name } : null,
  });
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
      /*
       * A failure may or may not have a restaurant behind it. A bad PIN at a
       * linked terminal does — the device resolved one before the PIN was
       * checked. An unverified Google token does not, and never will.
       *
       * Passing null explicitly on that path tells AuditLog.record to write
       * the entry unscoped rather than throw, which is what keeps the most
       * security-relevant events in the trail instead of dropping exactly the
       * ones nobody can attribute.
       */
      tenantId: getTenantId() ?? null,
    },
    req,
  );

  logger.warn('Login failed', { requestId: req.id, reason, ip: req.ip });
}

// ---------------------------------------------------------------------------
// POST /api/auth/google
// ---------------------------------------------------------------------------
/**
 * One client, reused. Constructing an OAuth2Client per request would discard
 * the cached copy of Google's signing keys and refetch them over the network
 * on every sign-in.
 */
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/**
 * Sign in with Google. The only way to become an administrator.
 *
 * ── Why no password anywhere ───────────────────────────────────────────────
 * Passwords for owners meant this codebase carried a reset flow, a lockout
 * policy and a bcrypt hash for accounts that sign in a few times a week. All
 * of it is now Google's problem, along with the 2FA a restaurant owner is far
 * more likely to have enabled there than here.
 *
 * ── What is verified ───────────────────────────────────────────────────────
 * `verifyIdToken` checks the signature against Google's published keys, plus
 * `iss`, `aud` and `exp`. It does NOT decide whether the address is real:
 * `email_verified` is ours to check, and it matters because email is how a
 * person is recognised — an unverified address means the holder may not
 * control the mailbox that identifies them.
 *
 * The client SECRET plays no part. Nothing here needs it, which is one fewer
 * credential to store or leak.
 */
export const loginGoogle = asyncHandler(async (req, res) => {
  const { credential } = req.body;

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    await recordFailure(req, { reason: 'google-token-invalid', identifier: 'google' });
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  if (!payload?.email_verified || !payload.email || !payload.sub) {
    await recordFailure(req, { reason: 'google-email-unverified', identifier: 'google' });
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  /*
   * Deliberately unscoped: there is no session yet, so there is no restaurant
   * to scope by — finding out which one this person belongs to is the point.
   * googleId is globally unique (see models/User.js), so this is a single
   * indexed equality, not a scan.
   */
  const existing = await runUnscoped('google sign-in: identity -> account', async () =>
    User.findOne({ googleId: payload.sub }).select('+tokenVersion'));

  if (existing && !existing.isActive) {
    await recordFailure(req, {
      userId: existing._id,
      reason: 'inactive-account',
      identifier: payload.email,
    });
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  /*
   * A first-time visitor. The account is created here, with no restaurant, so
   * that abandoning onboarding and coming back lands on the same account
   * rather than minting a new one each visit.
   *
   * No burnTiming on this path: a Google ID token is already proof of
   * identity, so there is no secret to compare and no enumeration oracle to
   * defend — the response says nothing the holder of the token did not
   * already know.
   */
  const user = existing ?? await runUnscoped('google sign-in: create the account', async () =>
    User.create({
      name: payload.name?.slice(0, 80) || payload.email.split('@')[0],
      email: payload.email,
      googleId: payload.sub,
      authProvider: 'google',
      role: ROLES.ADMIN,
      avatarUrl: payload.picture ?? '',
      tenantId: null,
      isActive: true,
    }));

  // Google is authoritative for these; keep them current on every sign-in.
  if (existing && payload.picture && existing.avatarUrl !== payload.picture) {
    existing.avatarUrl = payload.picture;
  }

  /*
   * An account with no restaurant is NOT an error. It is a real session whose
   * token carries an empty tenant claim, which the model plugin then refuses
   * for every scoped query — so it can reach exactly the two endpoints
   * onboarding needs (GET /auth/me and POST /tenants) and nothing else.
   *
   * Issuing a normal session rather than a special-purpose signup ticket means
   * POST /tenants sits behind the ordinary requireAuth wall, so there is no
   * second, weaker authentication path to review.
   */
  if (!user.tenantId) {
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
        meta: { method: 'google', onboarding: true },
        // No tenant exists to attribute this to yet.
        tenantId: null,
      },
      req,
    );

    return sendSuccess(res, {
      accessToken,
      user: publicUser(user),
      onboarding: {
        required: true,
        reason: 'no-restaurant',
        // A sensible default for the name field, not a decision.
        suggestedName: payload.given_name ? `${payload.given_name}'s Restaurant` : '',
      },
    });
  }

  // An established owner. Everything below belongs to their restaurant.
  return runInTenant(user.tenantId, async () => {
    const tenant = await Tenant.findById(user.tenantId).lean();

    if (!tenant?.isActive) {
      await recordFailure(req, {
        userId: user._id,
        reason: 'restaurant-inactive',
        identifier: payload.email,
      });
      throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
    }

    return completeLogin(req, res, user, { tenant });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login/staff
// ---------------------------------------------------------------------------
/**
 * Sign in with a 4-digit PIN, at a terminal that knows which restaurant it is.
 *
 * ── The ordering that makes this safe ──────────────────────────────────────
 * The restaurant is resolved FIRST, from the device cookie, and the PIN is
 * matched only within it. That ordering is the whole fix: PINs are unique per
 * restaurant, not globally, so two venues can both issue 1234 and a lookup
 * without a restaurant would be ambiguous at best and a cross-restaurant
 * sign-in at worst.
 */
export const loginStaff = asyncHandler(async (req, res) => {
  const { pin } = req.body;
  const deviceToken = req.cookies?.[DEVICE_COOKIE];

  /*
   * An unlinked terminal is told so, plainly.
   *
   * This deliberately breaks the "one message for every failure" rule that
   * governs the rest of this file, and it is not an exception worth worrying
   * about: it reveals only that THIS BROWSER holds no device cookie, which the
   * browser already knows. It reveals nothing about any account, and the
   * client needs to distinguish it to show the setup screen rather than a red
   * "wrong PIN" under the keypad.
   */
  if (!deviceToken) {
    throw ApiError.unauthorized('This terminal is not linked to a restaurant', {
      code: 'TERMINAL_NOT_LINKED',
    });
  }

  // Unscoped for the same reason as the Google lookup: this IS the resolution.
  const device = await runUnscoped('staff login: device token -> restaurant', async () =>
    Device.findByToken(deviceToken));

  if (!device) {
    // The cookie is stale — the terminal was unlinked, or the pepper rotated.
    // Clearing it means the client stops presenting a token that cannot work.
    res.clearCookie(DEVICE_COOKIE, clearDeviceCookieOptions());
    throw ApiError.unauthorized('This terminal is not linked to a restaurant', {
      code: 'TERMINAL_NOT_LINKED',
    });
  }

  return runInTenant(device.tenantId, async () => {
    /*
     * One indexed lookup via the peppered lookup hash. The tenant filter is
     * added by the model plugin, so findActiveByPin needed no change at all —
     * it is the {tenantId, pinLookup} index that makes this both correct and
     * still O(1).
     */
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

    // Fire-and-forget: a failed timestamp write must not fail a valid login.
    device.lastSeenAt = new Date();
    device.save().catch(() => {});

    const tenant = await Tenant.findById(device.tenantId).lean();
    return completeLogin(req, res, user, { tenant, device });
  });
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
/**
 * The current session.
 *
 * Reached by two quite different callers, which is why the restaurant may be
 * null: a signed-in member of staff whose session is being restored on page
 * load, and a Google account that has authenticated but not yet named a
 * restaurant. The second is the only other endpoint such a session can reach,
 * and `onboarding` is how the client knows to render that step instead of the
 * app.
 */
export const me = asyncHandler(async (req, res) => {
  const tenant = req.tenantId ? await Tenant.findById(req.tenantId).lean() : null;

  /*
   * The terminal belongs in the session payload, not only in the public
   * /auth/terminal probe. That probe is unauthenticated, so it can only report
   * what the cookie says — and on a shared browser the cookie may name someone
   * else's restaurant. Here there IS a session to check it against, so this is
   * the only answer that can be trusted to decide whether the client offers
   * terminal setup.
   */
  const terminal = await ownTerminal(req, req.tenantId);

  return sendSuccess(res, {
    user: publicUser(req.authUser),
    restaurant: tenant ? { id: String(tenant._id), name: tenant.name, slug: tenant.slug } : null,
    terminal: terminal ? { id: String(terminal._id), name: terminal.name } : null,
    onboarding: req.tenantId ? null : { required: true, reason: 'no-restaurant' },
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/terminal     (public — no session)
// ---------------------------------------------------------------------------
/**
 * What restaurant is this terminal linked to?
 *
 * The login screen needs the name BEFORE anyone signs in — a keypad that says
 * only "enter your PIN" gives a cashier no way to notice they are standing at
 * the wrong restaurant's terminal, and no way to tell an unlinked machine from
 * a broken one.
 *
 * Deliberately unauthenticated, because nobody has a session at this point.
 * What it discloses is bounded to what the holder of this browser's cookie has
 * already been granted by an owner who linked the machine: two names, and
 * nothing about any account, any staff member or any PIN. An unlinked or
 * revoked terminal gets `linked: false` rather than an error, because that is
 * a normal state with its own screen.
 */
export const terminalInfo = asyncHandler(async (req, res) => {
  const deviceToken = req.cookies?.[DEVICE_COOKIE];
  if (!deviceToken) return sendSuccess(res, { linked: false, restaurant: null, terminal: null });

  const device = await runUnscoped('terminal label: device token -> restaurant', async () =>
    Device.findByToken(deviceToken));

  if (!device) {
    res.clearCookie(DEVICE_COOKIE, clearDeviceCookieOptions());
    return sendSuccess(res, { linked: false, restaurant: null, terminal: null });
  }

  return runInTenant(device.tenantId, async () => {
    const tenant = await Tenant.findById(device.tenantId).lean();
    if (!tenant?.isActive) {
      return sendSuccess(res, { linked: false, restaurant: null, terminal: null });
    }

    return sendSuccess(res, {
      linked: true,
      restaurant: { name: tenant.name, slug: tenant.slug },
      terminal: { name: device.name },
    });
  });
});

export default { loginGoogle, loginStaff, refresh, logout, me, terminalInfo };
