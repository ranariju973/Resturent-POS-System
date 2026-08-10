/**
 * Token minting and verification.
 *
 * Two token types, two secrets, two audiences:
 *
 *   access   15m, sent in the Authorization header, held in memory by the
 *            client. Short-lived because it is the one an XSS payload could
 *            read if the frontend ever stores it carelessly.
 *   refresh  7d, sent ONLY as an httpOnly cookie, never in a response body,
 *            single-use (see RefreshToken.js).
 *
 * The `typ` claim is checked on verify so a refresh token cannot be presented
 * as an access token. Signing them with different secrets already prevents
 * that, but a claim check is cheap and survives someone later "simplifying"
 * the config down to one secret.
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const ISSUER = 'verdant-pos';
const AUDIENCE = 'verdant-pos-client';

export const TOKEN_TYPE = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
  STREAM: 'stream',
});

/**
 * How long a stream ticket is valid. Long enough to hand to EventSource and
 * connect; far too short to be worth stealing out of a log.
 */
const STREAM_TOKEN_TTL_SECONDS = 60;

/**
 * Mint an access token.
 *
 * The payload is deliberately minimal: a subject, a role, and a token
 * version. It carries NO name, email or PIN — a JWT is signed, not encrypted,
 * so anyone holding it can read every claim. `role` is present only as a hint
 * for the client's UI; authorisation always re-reads the role from the
 * database (see requireAuth), never from the token.
 *
 * @param {{id: any, role: string, tokenVersion?: number}} user
 * @returns {string}
 */
export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id ?? user._id),
      role: user.role,
      tv: user.tokenVersion ?? 0,
      typ: TOKEN_TYPE.ACCESS,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    },
  );
}

/**
 * Mint a refresh token. Returns the jti and expiry alongside it so the caller
 * can persist a record without re-decoding.
 *
 * @param {{id: any, role: string, tokenVersion?: number}} user
 * @param {{family: any}} opts
 * @returns {{token: string, jti: string, family: any, expiresAt: Date}}
 */
export function signRefreshToken(user, { family }) {
  const jti = randomUUID();

  const token = jwt.sign(
    {
      sub: String(user.id ?? user._id),
      tv: user.tokenVersion ?? 0,
      fam: String(family),
      typ: TOKEN_TYPE.REFRESH,
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
      jwtid: jti,
    },
  );

  const { exp } = jwt.decode(token);
  return { token, jti, family, expiresAt: new Date(exp * 1000) };
}

/**
 * Verify an access token.
 * Throws on any problem — the error handler maps every JWT error to the same
 * generic 401, so a caller cannot learn whether a token was expired,
 * malformed or forged.
 *
 * @param {string} token
 * @returns {object} decoded payload
 */
export function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    // Pinning the algorithm blocks the classic 'alg: none' and
    // RS256-downgraded-to-HS256 forgeries.
    algorithms: ['HS256'],
  });

  if (payload.typ !== TOKEN_TYPE.ACCESS) {
    throw new jwt.JsonWebTokenError('Wrong token type');
  }
  return payload;
}

/**
 * Verify a refresh token.
 * @param {string} token
 * @returns {object} decoded payload
 */
export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });

  if (payload.typ !== TOKEN_TYPE.REFRESH) {
    throw new jwt.JsonWebTokenError('Wrong token type');
  }
  return payload;
}

// --- Stream tokens ---------------------------------------------------------

/**
 * Mint a one-minute token for opening an SSE connection.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * The browser's `EventSource` cannot set an `Authorization` header. That
 * leaves three options, and two of them are bad:
 *
 *   1. Put the ACCESS token in the query string — it then lands in access
 *      logs, proxy logs and browser history, and it is valid for 15 minutes
 *      against every endpoint in the API.
 *   2. Authenticate the stream by cookie — but the refresh cookie is
 *      `sameSite: strict` and scoped to /api/auth, deliberately.
 *   3. Mint a token that is valid for SIXTY SECONDS and for OPENING A STREAM
 *      ONLY. If it leaks into a log it is already expired, and even fresh it
 *      cannot read an order or move a ticket.
 *
 * This is (3). The `typ: 'stream'` claim is checked on the way in, so a stream
 * token presented as a bearer token is rejected by `verifyAccessToken`, and an
 * access token pasted into the query string is rejected here.
 *
 * @param {{id: any, role: string, tokenVersion?: number}} user
 */
export function signStreamToken(user) {
  return jwt.sign(
    {
      sub: String(user.id ?? user._id),
      tv: user.tokenVersion ?? 0,
      typ: TOKEN_TYPE.STREAM,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: STREAM_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    },
  );
}

/** Verify a stream token. Rejects access and refresh tokens by `typ`. */
export function verifyStreamToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });

  if (payload.typ !== TOKEN_TYPE.STREAM) {
    throw new jwt.JsonWebTokenError('Wrong token type');
  }
  return payload;
}

export { STREAM_TOKEN_TTL_SECONDS };

// --- Refresh cookie --------------------------------------------------------

export const REFRESH_COOKIE = 'vp_rt';

/**
 * Cookie options for the refresh token.
 *
 *   httpOnly  JavaScript cannot read it, so XSS cannot exfiltrate the session.
 *   secure    HTTPS only. Off in development, where there is no TLS.
 *   sameSite  Depends on how the app is deployed — see below.
 *   path      scoped to the auth routes, so it is not sent on every API call
 *             it has no business being attached to.
 *
 * ── Why sameSite differs by environment ────────────────────────────────────
 * In development the frontend is served by Vite, which proxies /api to this
 * server, so browser and API share an origin and 'strict' costs nothing.
 *
 * In production the frontend is on Vercel and this API is on Render — two
 * different sites. A 'strict' cookie is withheld on every cross-site request,
 * so the silent re-auth on page load never receives it and the user is
 * logged out by a refresh. 'none' is what allows a split deployment to work.
 *
 * The trade-off is real: 'strict' was this cookie's CSRF defence. What still
 * stands in its place is httpOnly (an attacker cannot read the rotated
 * token), the '/api/auth' path scope (it is never attached to data routes),
 * and the exact-match CORS allow-list in app.js, which refuses to reflect an
 * arbitrary Origin and so denies the attacker's page the response body. The
 * residual exposure is a forced token rotation, not session theft.
 *
 * If both halves ever move behind one origin, change this back to 'strict'.
 */
const REFRESH_COOKIE_SAME_SITE = env.isProd ? 'none' : 'strict';

export function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: REFRESH_COOKIE_SAME_SITE,
    path: '/api/auth',
    expires: expiresAt,
  };
}

/** Matching options for clearing — a cookie only clears on an exact attribute match. */
export function clearRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: REFRESH_COOKIE_SAME_SITE,
    path: '/api/auth',
  };
}

export default {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshCookieOptions,
  clearRefreshCookieOptions,
  REFRESH_COOKIE,
  TOKEN_TYPE,
};
