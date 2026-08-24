/**
 * Which restaurant the current work belongs to.
 *
 * ── Why this is ambient and not a parameter ────────────────────────────────
 * Every query in a multi-restaurant system has to be filtered by tenant, and
 * there are ~155 model calls across 15 controllers. Threading a tenantId
 * argument through all of them — and through every model static, every
 * populate, every aggregation — is a change that has to be made perfectly
 * once and then perfectly again in every file added afterwards. It fails
 * OPEN: a forgotten filter returns another restaurant's data and looks like a
 * working page.
 *
 * So the tenant rides in AsyncLocalStorage instead, and `tenantScoped`
 * (src/models/plugins/tenantScoped.js) reads it inside Mongoose's own query
 * hooks. A controller cannot forget to filter, because the controller is not
 * the thing doing the filtering.
 *
 * ── The rule that makes it safe ────────────────────────────────────────────
 * A scoped query with no tenant in context THROWS. It does not fall back to
 * "all tenants" — that fallback is precisely the leak this exists to prevent.
 * The cost is that anything running outside a request (scripts, timers,
 * fire-and-forget writes) must say which world it is in, using one of the two
 * helpers below. That is a visible, greppable failure at development time
 * rather than a silent one in production.
 *
 * ── Node's guarantee ───────────────────────────────────────────────────────
 * AsyncLocalStorage propagates through awaits, promise chains and callbacks,
 * so `runInTenant(id, () => next())` covers the entire downstream middleware
 * chain and every query it makes. It does NOT propagate to work that was
 * already scheduled elsewhere — an EventEmitter listener registered earlier
 * runs in the context it was registered in, which is why event payloads carry
 * their tenant explicitly (see utils/eventBus.js).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Marks a store as a deliberate cross-tenant escape.
 *
 * A Symbol, not a string key, so a plain object arriving from JSON — a request
 * body, a cached document — can never accidentally satisfy the check.
 */
const UNSCOPED = Symbol('tenant:unscoped');

/**
 * The current tenant's id, or null when there is none.
 *
 * Callers that need a tenant should use `requireTenantId()` instead: this one
 * returning null is exactly the ambiguity that leads to an unfiltered query.
 */
export function getTenantId() {
  return storage.getStore()?.tenantId ?? null;
}

/** True inside `runUnscoped`. Scoped queries skip their filter when this is set. */
export function isUnscoped() {
  return storage.getStore()?.[UNSCOPED] === true;
}

/**
 * The current tenant's id, or a thrown error.
 *
 * @param {string} what Names the caller in the error, so a stack trace is not
 *   the only clue about which query had no tenant.
 */
export function requireTenantId(what = 'this operation') {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new TenantContextMissing(what);
  }
  return tenantId;
}

/**
 * Run `fn` as a given restaurant. Everything it queries is scoped to that
 * tenant, including work it awaits.
 *
 * @template T
 * @param {import('mongoose').Types.ObjectId|string} tenantId
 * @param {() => T} fn
 * @returns {T}
 */
export function runInTenant(tenantId, fn) {
  if (!tenantId) throw new TenantContextMissing('runInTenant');
  return storage.run({ tenantId }, fn);
}

/**
 * Run `fn` with tenant filtering switched OFF.
 *
 * ── Read this before using it ──────────────────────────────────────────────
 * This is the one way to read across every restaurant at once, so each call
 * site is a place where a bug becomes a data leak between customers. It is
 * legitimate in exactly one shape: resolving WHICH tenant something belongs
 * to, from a credential that is globally unique by design — a Google account
 * id, an invoice link token, a device token, a refresh token jti, a webhook
 * api key. Having resolved it, hand straight over to `runInTenant` and do the
 * real work there.
 *
 * `why` is required rather than optional so that
 *
 *     grep -rn "runUnscoped" src/
 *
 * produces a readable inventory of every cross-tenant read in the codebase.
 * That list is the security-review surface; tests/tenant-coverage.test.mjs
 * counts it, so adding one is a deliberate act that shows up in review.
 *
 * @template T
 * @param {string} why Short reason, e.g. 'invoice token -> tenant resolution'.
 * @param {() => T} fn
 * @returns {T}
 */
export function runUnscoped(why, fn) {
  if (typeof why !== 'string' || why.trim() === '') {
    throw new Error('runUnscoped requires a reason describing why this reads across tenants');
  }
  return storage.run({ [UNSCOPED]: true, why }, fn);
}

/**
 * Thrown when a tenant-scoped query runs with no tenant in context.
 *
 * Deliberately NOT an ApiError: this is a programming error, not something a
 * client did. It should surface as a 500 and be fixed, never be handed to a
 * user as a 400 they can do nothing about.
 */
export class TenantContextMissing extends Error {
  constructor(what) {
    super(
      `${what} ran without a tenant in context. Scoped queries refuse to run unfiltered — `
        + 'wrap this in runInTenant(id, fn), or runUnscoped(why, fn) if it must genuinely '
        + 'read across restaurants.',
    );
    this.name = 'TenantContextMissing';
    this.status = 500;
    this.expected = false;
  }
}

export { UNSCOPED };
