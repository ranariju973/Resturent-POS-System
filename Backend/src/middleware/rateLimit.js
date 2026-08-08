/**
 * Rate limiters.
 *
 * Phase 2 needs the login limiter now; Phase 4 mounts the general API limiter
 * and tunes both. They live together so the whole traffic-control policy is
 * readable in one file.
 *
 * ── Why login needs its own, much stricter limiter ─────────────────────────
 * A 4-digit PIN has 10,000 possible values. At the general API rate of 100
 * requests a minute, the entire keyspace falls in under two hours. Account
 * lockout (5 attempts, in User.js) defends a single account; this defends the
 * endpoint itself, where an attacker sprays one PIN across all accounts at
 * once and never trips any individual account's counter.
 */
import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Normalises a request's IP into a rate-limit key.
 *
 * express-rate-limit only began exporting its own `ipKeyGenerator` in v8; this
 * project is pinned to v7, so the behaviour is implemented locally rather than
 * taking a major-version bump for one helper.
 *
 * IPv6 addresses are truncated to their /64 prefix. A single customer is
 * routinely handed a /64 (or larger), so keying on the full address would let
 * an attacker rotate through addresses to reset the counter for free. IPv4 —
 * including IPv4-mapped IPv6 like `::ffff:1.2.3.4` — is keyed whole.
 */
export function ipKeyGenerator(req) {
  const raw = req.ip;
  if (!raw) return 'unknown';

  // Strip any zone index (e.g. `fe80::1%en0`).
  const ip = raw.split('%')[0];

  if (!ip.includes(':')) return ip; // plain IPv4

  // IPv4-mapped/-compatible IPv6 carries a dotted quad in the last group.
  const lastGroup = ip.slice(ip.lastIndexOf(':') + 1);
  if (lastGroup.includes('.')) return lastGroup;

  // Expand `::` so the first four hextets can be read positionally.
  let groups;
  if (ip.includes('::')) {
    const [head, tail] = ip.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    groups = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  } else {
    groups = ip.split(':');
  }

  const prefix = groups
    .slice(0, 4)
    .map((g) => (g === '' ? '0' : g.toLowerCase().replace(/^0+(?=.)/, '')))
    .join(':');

  return `${prefix}::/64`;
}

/** Shared handler so every limiter produces the same envelope as the rest of the API. */
function limitHandler(req, _res, next, options) {
  logger.warn('Rate limit exceeded', {
    requestId: req.id,
    ip: req.ip,
    path: req.originalUrl,
    limit: options.max,
  });
  next(ApiError.tooManyRequests('Too many requests — please slow down'));
}

const baseOptions = {
  standardHeaders: 'draft-7', // RateLimit-* headers
  legacyHeaders: false,
  handler: limitHandler,
  // Disabled entirely under NODE_ENV=test so a test suite is not throttled.
  skip: () => env.isTest,
};

/**
 * Login endpoints. Deliberately tight.
 *
 * `skipSuccessfulRequests` means a busy shift of legitimate sign-ins never
 * exhausts the budget — only failures count. A staff member fat-fingering a
 * PIN twice is unaffected; an attacker grinding the keyspace is stopped at 5.
 */
export const loginLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  // Normalises IPv6 to a /64 prefix, so an attacker with a large IPv6
  // allocation cannot trivially rotate addresses to reset the count.
  keyGenerator: ipKeyGenerator,
});

/**
 * Refresh endpoint. Looser than login — a legitimate client refreshes every
 * 15 minutes — but still bounded, since refresh does a database lookup.
 */
export const refreshLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 30,
});

/**
 * General API limiter. Mounted in Phase 4.
 * Sized for a POS: a busy terminal polls the kitchen board and writes orders,
 * so this has to sit well above normal use to avoid throttling real service.
 */
export const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: 300,
});

/**
 * Customer phone lookup.
 *
 * This one is not about load, it is about enumeration. The endpoint answers
 * "which customer owns this number", so an unbounded budget turns any POS
 * login into a reverse phone directory that can be walked at machine speed.
 *
 * Keyed on the authenticated user rather than the IP: every terminal in a
 * restaurant shares one NAT address, so an IP budget would either be so large
 * it stops nothing or so small it throttles the second till.
 *
 * ── Why 400 and not the 60 this used to be ─────────────────────────────────
 * 60 was sized for "a cashier does a handful of lookups per shift", which
 * turned out to describe nobody. The till fires a request per settled phone
 * entry, so a service doing 60-80 covers an hour exhausted the budget before
 * the lunch rush finished — and because a throttled lookup is indistinguishable
 * from "no match" at the counter, it read as the search being broken rather
 * than blocked.
 *
 * 400 is roughly five times realistic peak use. It does not weaken the
 * enumeration defence, because that was never the ceiling doing the work: the
 * suggest endpoint caps results at five, masks the middle of every number, and
 * refuses below four digits. Walking a ten-digit space needs millions of
 * probes; the difference between 60 and 400 of them is noise.
 */
export const lookupLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  max: 400,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req)),
});

/**
 * Public invoice links.
 *
 * The token in the URL is the real defence — 192 bits is not walked, whatever
 * the budget. This is depth: it bounds how fast someone can probe for a lucky
 * hit, and it bounds what a scraper costs the server.
 *
 * Keyed by IP because the caller is a customer with no session by definition.
 * Generous enough that a family opening the same receipt on four phones behind
 * one router never notices it.
 */
export const invoiceLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  max: 120,
  keyGenerator: (req) => ipKeyGenerator(req),
});

export default { loginLimiter, refreshLimiter, apiLimiter, lookupLimiter, invoiceLimiter };
