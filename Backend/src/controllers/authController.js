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

/**
 * Told to an owner whose password was discarded when their Google identity
 * claimed the account — see the linking branch in loginGoogle.
 *
 * Said out loud rather than left to be discovered at the next sign-in. There
 * is no password-reset flow here, so someone who finds out by being refused
 * has no way to work out why or what to do instead.
 */
const PASSWORD_RETIRED_NOTICE =
  'Your account is now signed in with Google. The password set on this email no longer works.';

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
 * @param {'google'|'password'|'pin'} context.method which door was actually
 *   used. Passed in rather than read back from `user.authProvider`, because an
 *   account can hold both a Google identity and a password — that field records
 *   how the account was created, which is a different question from how this
 *   particular session started.
 * @param {string} [context.notice] something that happened TO the account
 *   during this sign-in that the person needs to be told about, in words they
 *   can act on. Not an error — the sign-in succeeded.
 */
async function completeLogin(req, res, user, { tenant, device, method, notice } = {}) {
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
      meta: { method },
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
    ...(notice ? { notice } : {}),
  });
}

/**
 * Shared tail of a successful sign-in by an account that has no restaurant yet.
 *
 * ── An account with no restaurant is NOT an error ──────────────────────────
 * It is a real session whose token carries an empty tenant claim, which the
 * model plugin then refuses for every scoped query — so it can reach exactly
 * the two endpoints onboarding needs (GET /auth/me and POST /tenants) and
 * nothing else.
 *
 * Issuing a normal session rather than a special-purpose signup ticket means
 * POST /tenants sits behind the ordinary requireAuth wall, so there is no
 * second, weaker authentication path to review.
 *
 * Both administrator doors land here — a first-time Google sign-in and a fresh
 * password signup produce byte-identical responses, which is why the client's
 * onboarding screen needed no knowledge of how the person got there.
 *
 * @param {'google'|'password'} method which door was used
 * @param {string} [suggestedName] a default for the restaurant-name field, not
 *   a decision
 */
async function completeOnboardingLogin(req, res, user, { method, suggestedName = '', notice }) {
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
      meta: { method, onboarding: true },
      // No tenant exists to attribute this to yet.
      tenantId: null,
    },
    req,
  );

  logger.info('Login succeeded, restaurant not yet named', {
    requestId: req.id,
    userId: String(user._id),
    method,
  });

  return sendSuccess(res, {
    accessToken,
    user: publicUser(user),
    onboarding: { required: true, reason: 'no-restaurant', suggestedName },
    ...(notice ? { notice } : {}),
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
  let existing = await runUnscoped('google sign-in: identity -> account', async () =>
    User.findOne({ googleId: payload.sub }).select('+tokenVersion'));

  /** Set when this sign-in claimed an account that had an unverified password. */
  let linkRetiredPassword = false;

  /*
   * ── Linking a password account to its owner's Google identity ────────────
   *
   * No googleId matched, but the address may already belong to an owner who
   * signed up with a password. Minting a second row for them would be wrong in
   * three separate ways: they would arrive at an empty restaurant, their menu
   * and orders would be unreachable, and the write itself collides on the
   * {tenantId, email} unique index — surfacing as an opaque 409 on a button
   * that says "Sign in with Google".
   *
   * Linking is safe because of what was checked above: Google asserted
   * `email_verified` on a token whose signature we validated against Google's
   * published keys. That is proof the caller controls the mailbox, which is
   * exactly the bar for claiming an account identified by it — the same proof
   * a password-reset email would provide.
   *
   * ── Why the password is RETIRED on the way through ───────────────────────
   * This is the part that is not optional, and the reasoning is worth stating
   * in full because the alternative looks harmless.
   *
   * There is no mail provider in this deployment, so signup cannot verify an
   * address. Anyone can therefore register `victim@gmail.com` with a password
   * of their choosing, having never touched that mailbox. If linking merely
   * ADDED the Google identity, the real owner's first Google sign-in would
   * drop them into the attacker's account — and the attacker would keep a
   * working password into the victim's restaurant. That is pre-registration
   * account hijacking, and it would be this feature's own doing.
   *
   * So the two credentials are not treated as equals, because they are not.
   * A password on this deployment proves nothing about the mailbox; a verified
   * Google token proves everything. When the two meet on one address, the
   * proven one takes the account and the unproven one is discarded, along with
   * every session it opened.
   *
   * The cost, stated plainly: an owner who signed up with a password and later
   * signs in with Google to add a recovery path loses that password. They keep
   * their account and their restaurant, and they sign in with Google from then
   * on — which is what the response tells them, via `notice`.
   *
   * Restricted to administrators on purpose. A cashier row may carry an email
   * (it is optional but allowed), and letting a Google token promote one into
   * an admin session would be a privilege escalation with no password involved.
   */
  if (!existing) {
    /*
     * `+passwordHash` because the decision below turns on whether one exists.
     * It is never compared and never leaves this handler — publicUser() does
     * not carry it, and the field is select:false precisely so that reading it
     * has to be asked for in writing, as here.
     */
    const byEmail = await runUnscoped('google sign-in: verified email -> existing account',
      async () => User.findOne({ email: payload.email, role: ROLES.ADMIN })
        .select('+tokenVersion +passwordHash'));

    if (byEmail?.googleId && byEmail.googleId !== payload.sub) {
      /*
       * The address is already linked to a DIFFERENT Google identity. Google
       * does not issue the same verified address to two accounts, so this is
       * either a Workspace alias or something adversarial; either way, silently
       * re-pointing an existing owner's account at a new identity is not an
       * outcome to guess at.
       */
      await recordFailure(req, {
        userId: byEmail._id,
        reason: 'google-email-claimed',
        identifier: payload.email,
      });
      throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
    }

    if (byEmail) {
      // Read before it is overwritten below.
      linkRetiredPassword = Boolean(byEmail.passwordHash);

      byEmail.googleId = payload.sub;
      byEmail.authProvider = 'google';
      existing = byEmail;

      if (linkRetiredPassword) {
        // Invalidates every access and refresh token the old credential minted,
        // so a session opened with it does not outlive it.
        byEmail.tokenVersion = (byEmail.tokenVersion ?? 0) + 1;
      }

      logger.info('Linked a Google identity to an existing account', {
        requestId: req.id,
        userId: String(byEmail._id),
        retiredPassword: linkRetiredPassword,
      });
    }
  }

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
   * A newly linked googleId (and any refreshed avatar) has to reach the
   * database before the session is issued — otherwise the next sign-in repeats
   * the whole lookup and the link is never actually made. Unscoped because a
   * linked account may still have no restaurant, and one that does is keyed
   * here by its own _id.
   */
  if (existing?.isModified?.()) {
    await runUnscoped('google sign-in: persist the linked identity', async () => existing.save());
  }

  /*
   * Retiring the password is a separate write, deliberately.
   *
   * `passwordHash` is select:false, so the loaded document does not carry it
   * and `save()` cannot remove a field it never read. An explicit $unset,
   * keyed by _id, is the only way to be sure the credential is actually gone
   * rather than merely absent from an in-memory copy.
   */
  if (linkRetiredPassword) {
    await runUnscoped('google sign-in: retire the unverified password', async () =>
      User.updateOne({ _id: existing._id }, { $unset: { passwordHash: 1 } }));

    await AuditLog.record(
      {
        actor: existing._id,
        actorName: existing.name,
        actorRole: existing.role,
        action: AUDIT_ACTION.PASSWORD_RETIRED,
        resource: 'User',
        resourceId: existing._id,
        meta: { reason: 'google-identity-linked' },
        tenantId: existing.tenantId ?? null,
      },
      req,
    );
  }

  if (!user.tenantId) {
    return completeOnboardingLogin(req, res, user, {
      method: 'google',
      suggestedName: payload.given_name ? `${payload.given_name}'s Restaurant` : '',
      notice: linkRetiredPassword ? PASSWORD_RETIRED_NOTICE : undefined,
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

    return completeLogin(req, res, user, {
      tenant,
      method: 'google',
      notice: linkRetiredPassword ? PASSWORD_RETIRED_NOTICE : undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
/**
 * Create an owner account with an email and a password.
 *
 * ── Why there is a second administrator door ───────────────────────────────
 * Google sign-in remains the recommended one — it carries whatever 2FA the
 * owner already has, and it stores no secret here. But requiring it makes a
 * Google account a prerequisite for running a restaurant, which is not a
 * dependency this product should impose. This door is the alternative, not a
 * weakening of the first: it lands on the same session, the same onboarding
 * step, the same lockout policy and the same audit trail.
 *
 * What it deliberately does NOT come with is a reset flow. There is no mail
 * provider in this deployment, so "forgot password" would be a button that
 * cannot work. An owner who wants a recovery path signs in once with Google on
 * the same address, which links the two (see loginGoogle) and leaves either
 * credential able to open the account.
 *
 * ── The 409 is an account-enumeration oracle, and that is the choice ───────
 * Telling a caller that an address is taken reveals that it is registered.
 * The alternative is answering "check your inbox" to every signup and
 * resolving the truth by email — which needs the mail provider we do not have.
 * Between an unusable form and a bounded disclosure, the disclosure wins: it
 * sits behind signupLimiter (5 per 15 minutes per address block, successes
 * included), and it says nothing about the account beyond its existence.
 */
export const registerWithPassword = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  /*
   * Unscoped for the usual reason: signup has no session, so there is no
   * restaurant to scope by. It has to look across all of them, because an
   * address held by an established owner would otherwise pass this check and
   * only fail later, in the middle of creating a second account for them.
   */
  const taken = await runUnscoped('signup: email -> existing account', async () =>
    User.emailTaken(email));

  if (taken) {
    throw ApiError.conflict('An account with that email already exists', {
      code: 'EMAIL_TAKEN',
    });
  }

  const user = new User({
    name,
    email,
    role: ROLES.ADMIN,
    authProvider: 'password',
    /*
     * No restaurant yet, exactly as a first-time Google sign-in produces. The
     * next step names one; until then this session can reach GET /auth/me and
     * POST /tenants and nothing else.
     */
    tenantId: null,
    isActive: true,
  });

  // Before save, not after: the pre('validate') hook refuses an administrator
  // holding neither a Google identity nor a password hash.
  await user.setPassword(password);

  try {
    await runUnscoped('signup: create the account', async () => user.save());
  } catch (err) {
    /*
     * The check above and this write are two round trips, and two signups on
     * the same address interleave through the gap. The {tenantId, email} unique
     * index is what actually decides — both rows are tenant-less, so they share
     * one index bucket and the loser lands here. Same answer either way.
     */
    if (err?.code === 11000) {
      throw ApiError.conflict('An account with that email already exists', {
        code: 'EMAIL_TAKEN',
      });
    }
    throw err;
  }

  logger.info('Owner account created', { requestId: req.id, userId: String(user._id) });

  return completeOnboardingLogin(req, res, user, { method: 'password' });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login/password
// ---------------------------------------------------------------------------
/**
 * Sign in as an owner with an email and a password.
 *
 * Structurally identical to loginStaff, and intentionally so — the same
 * generic failure message, the same timing burn, the same progressive lockout.
 * The only difference is what resolves the account: an email rather than a
 * terminal's device cookie.
 *
 * An administrator who signed up with Google and never set a password reaches
 * the wrong-password branch rather than a distinguishable one, because
 * verifyPassword returns false when no hash is loaded instead of throwing. So
 * this door cannot be used to discover which door an account actually uses.
 */
export const loginPassword = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Unscoped: this IS the resolution. Calling the static without the wrapper
  // would throw TenantContextMissing — a 500, not a 401.
  const user = await runUnscoped('password sign-in: email -> account', async () =>
    User.findActiveAdminByEmail(email));

  if (!user) {
    await burnTiming(password);
    await recordFailure(req, { reason: 'unknown-email', identifier: email });
    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  if (user.isLocked) {
    await recordFailure(req, { userId: user._id, reason: 'locked', identifier: email });
    throw ApiError.tooManyRequests(LOCKED_MESSAGE);
  }

  const ok = await user.verifyPassword(password);

  if (!ok) {
    const nowLocked = await user.registerFailedLogin();
    await recordFailure(req, { userId: user._id, reason: 'bad-password', identifier: email });

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
          // A locked account may still have no restaurant to attribute this to.
          tenantId: user.tenantId ?? null,
        },
        req,
      );
    }

    throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
  }

  // Authenticated, but possibly mid-onboarding — an owner can abandon the
  // naming step and come back on a later day.
  if (!user.tenantId) {
    return completeOnboardingLogin(req, res, user, { method: 'password' });
  }

  return runInTenant(user.tenantId, async () => {
    const tenant = await Tenant.findById(user.tenantId).lean();

    if (!tenant?.isActive) {
      await recordFailure(req, {
        userId: user._id,
        reason: 'restaurant-inactive',
        identifier: email,
      });
      throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
    }

    return completeLogin(req, res, user, { tenant, method: 'password' });
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
    return completeLogin(req, res, user, { tenant, device, method: 'pin' });
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

  /*
   * Unscoped, necessarily — and this is what made refresh fail with a 500.
   *
   * `User` is tenant-scoped, and POST /api/auth/refresh carries no session:
   * it runs before requireAuth, so nothing has entered a tenant context. A
   * scoped query with no tenant does not fall back to "all tenants", it
   * THROWS — by design, because falling back is how one restaurant's data
   * leaks into another's. The throw surfaced as a 500, the client read that as
   * a dead session, and the user was signed out on every page reload.
   *
   * Same shape as the other identity lookups in this file: the key is a
   * globally unique ObjectId taken from a token this handler has already
   * verified and hash-matched, so it can only ever return the one row that
   * token names. The tenant is a property OF that row — which is precisely why
   * it cannot be known before the row is loaded.
   */
  const user = await runUnscoped('refresh: token subject -> account (the tenant lives on it)',
    async () => User.findById(stored.user).select('+tokenVersion'));

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

export default {
  loginGoogle,
  registerWithPassword,
  loginPassword,
  loginStaff,
  refresh,
  logout,
  me,
  terminalInfo,
};
