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
 * Every key is built through `key()`, which prefixes a tenant. There is one
 * tenant today and it is hardcoded, which costs nothing now and means a
 * multi-tenant future does not have to find and re-key every cache entry —
 * the alternative being one restaurant's dashboard served to another.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 * There is no bound on entry count. Every current caller uses a small, fixed
 * set of keys (the menu, one dashboard per role, one report per date), so the
 * map cannot grow with traffic. Do NOT cache anything keyed by something a
 * user controls — an order id, a search term — without adding an eviction
 * policy first, or this becomes a memory leak with a friendly interface.
 */
import { logger } from './logger.js';

/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const store = new Map();

/**
 * The single tenant, until there are more.
 *
 * Reading it from one place means the multi-tenant change is "make this a
 * parameter", not "audit every key in the codebase".
 */
export const DEFAULT_TENANT = 'default';

/** Build a namespaced key: `pos:{tenant}:{parts...}`. */
export const key = (...parts) => `pos:${DEFAULT_TENANT}:${parts.join(':')}`;

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
  store.set(k, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Drop one key. */
export async function del(k) {
  store.delete(k);
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

  const value = await compute();
  await set(k, value, ttlMs);
  return value;
}

/** Testing and shutdown only. */
export function clearAll() {
  store.clear();
}

/** Entry count, for the health check and tests. Not a hit rate. */
export const size = () => store.size;

if (process.env.NODE_ENV !== 'test') {
  logger.debug('Cache initialised (in-process)');
}

export default { key, get, set, del, delPrefix, remember, clearAll, size, DEFAULT_TENANT };
