/**
 * A small TTL cache with a Redis-shaped interface.
 *
 * ── Why this is in-process and not Redis ───────────────────────────────────
 * Redis buys three things: a cache shared between instances, a shared rate
 * limit, and cross-instance pub/sub. All three matter the moment a second
 * instance exists and none of them matter before that — one process reading
 * its own memory has no coherence problem to solve. Adding Redis today would
 * buy a network round trip on every read, a monthly bill, and one more service
 * that can be down, in exchange for benefits that do not yet apply.
 *
 * So the interface is the part that matters. `get`/`set`/`del`/`delPrefix` are
 * async and key-based precisely so the day a second instance appears, this
 * file is the only one that changes: swap the Map for a Redis client and every
 * call site keeps working. DEPLOYMENT.md names the two things that force that
 * day — the in-memory rate limiter and the in-process SSE bus.
 *
 * ── Keys ───────────────────────────────────────────────────────────────────
 * Every key is built through `key()`, which prefixes the tenant taken from the
 * ambient request context. That prefix is what stops one restaurant's cached
 * dashboard, menu or receipt header being served to another.
 *
 * Expired entries are swept on writes; the oldest entry is evicted at 2,048.
 * Concurrent reads of the same missing key share one loader. Invalidation
 * also prevents an earlier in-flight loader from repopulating stale data.
 */
import { logger } from './logger.js';
import { getTenantId } from './tenantContext.js';

/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const store = new Map();
const inFlight = new Map();
const MAX_ENTRIES = 2048;

/**
 * Used when a key is built outside any request — a boot-time warm-up, a
 * script. Never reached on a normal request path, where a tenant is always in
 * context.
 */
export const GLOBAL_TENANT = 'global';

/**
 * Build a namespaced key: `pos:{tenant}:{parts...}`.
 *
 * The tenant comes from the ambient request context, which is what keeps one
 * restaurant's cached menu, dashboard or receipt header from being served to
 * another. Every existing call site kept working unchanged when this became
 * tenant-aware — the seam this file's header describes was built for exactly
 * this change.
 *
 * A key built with no tenant falls back to a `global` namespace rather than
 * throwing. That is deliberate and is NOT the same leniency the model plugin
 * refuses: an unscoped cache key can only ever collide with other unscoped
 * keys, so the failure mode is a wasted cache slot, not one restaurant reading
 * another's data. The queries behind these entries are themselves scoped and
 * would throw on their own.
 */
export const key = (...parts) => {
  const tenantId = getTenantId();
  return `pos:${tenantId ?? GLOBAL_TENANT}:${parts.join(':')}`;
};

/**
 * Read a live entry, or null.
 *
 * Expiry is checked on read rather than by a timer: a sweeping interval would
 * keep the event loop busy on a free-tier instance to delete a handful of
 * entries that cost nothing to hold.
 */
export async function get(k) {
  const hit = store.get(k);
  if (!hit) return null;

  if (Date.now() >= hit.expiresAt) {
    store.delete(k);
    return null;
  }
  return hit.value;
}

/** Store a value for `ttlMs`. */
export async function set(k, value, ttlMs) {
  for (const [existing, entry] of store) {
    if (entry.expiresAt <= Date.now()) store.delete(existing);
  }
  if (!store.has(k) && store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(k, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Drop one key. */
export async function del(k) {
  store.delete(k);
  inFlight.delete(k);
}

/**
 * Drop every key under a prefix — "forget the whole menu" after any menu write,
 * rather than tracking which of its several keys a given edit invalidated.
 *
 * A Map scan is fine at this size. Against Redis this becomes SCAN + DEL, or a
 * version counter in the key, since KEYS on a live server is a stall.
 */
export async function delPrefix(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
  for (const k of inFlight.keys()) if (k.startsWith(prefix)) inFlight.delete(k);
}

/**
 * Read-through: return the cached value, or compute, store and return it.
 *
 * A failure in `compute` must not be cached — a 30-second window where every
 * request gets a stored error is worse than the error itself.
 */
export async function remember(k, ttlMs, compute) {
  const hit = await get(k);
  if (hit !== null) return hit;

  if (inFlight.has(k)) return inFlight.get(k);
  const pending = Promise.resolve().then(compute).then(async (value) => {
    if (inFlight.get(k) === pending) await set(k, value, ttlMs);
    return value;
  }).finally(() => { if (inFlight.get(k) === pending) inFlight.delete(k); });
  inFlight.set(k, pending);
  return pending;
}

/** Testing and shutdown only. */
export function clearAll() {
  store.clear();
  inFlight.clear();
}

/** Entry count, for the health check and tests. Not a hit rate. */
export const size = () => store.size;

if (process.env.NODE_ENV !== 'test') {
  logger.debug('Cache initialised (in-process)');
}

export default { key, get, set, del, delPrefix, remember, clearAll, size, GLOBAL_TENANT };
