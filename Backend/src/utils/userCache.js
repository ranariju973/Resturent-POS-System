/**
 * Caching the per-request user lookup.
 *
 * ── What this is buying ────────────────────────────────────────────────────
 * middleware/auth.js loads the user from MongoDB on EVERY authenticated
 * request. That is deliberate and its reasoning is worth reading in full at
 * the top of that file: a JWT states what was true when it was minted, so the
 * token proves identity and the DATABASE decides authorisation. A cashier
 * demoted mid-shift loses access immediately rather than when their token
 * expires.
 *
 * The cost is one indexed read per request, and requests come in bursts —
 * opening a bill used to make four or five, each repeating the same lookup for
 * the same person within a second or two.
 *
 * ── The trade, stated plainly ──────────────────────────────────────────────
 * With a 30-second TTL, "the database decides on every request" becomes "the
 * database decides within 30 seconds". That is a real weakening and it was
 * chosen knowingly.
 *
 * What makes it acceptable is that every DELIBERATE change clears the entry at
 * once: the User model invalidates this cache on any write (see the hooks in
 * models/User.js), so deactivating an account, changing a role, resetting a
 * PIN or a logout-everywhere all take effect on the next request, exactly as
 * before. The 30-second window only applies to someone editing the database
 * directly, out of band — and an attacker with write access to the users
 * collection is not a threat a permission cache was ever going to contain.
 *
 * ── Why the whole prefix is dropped, not one key ───────────────────────────
 * There are tens of staff, not thousands, and user writes are rare: an admin
 * editing the roster, or a login. Dropping every entry on any write costs
 * almost nothing and removes the class of bug where an invalidation targets
 * the wrong id and a stale permission survives. Correctness is worth more here
 * than the handful of reads it saves.
 *
 * ── Why lean objects ───────────────────────────────────────────────────────
 * The cached value is a PLAIN object, never a Mongoose document. A document is
 * mutable and tracks its own dirty state, so a handler that touched a shared
 * cached one could corrupt what every other request sees, or save changes
 * nobody asked for. req.authUser has exactly one consumer (GET /api/auth/me →
 * publicUser), which reads plain fields and works fine with a lean object.
 */
import { key, remember, delPrefix } from './cache.js';

const TTL_MS = 30_000;

const USERS_PREFIX = key('user');

/** Read-through by id. `compute` must return a lean object or null. */
export const rememberUser = (id, compute) => remember(key('user', String(id)), TTL_MS, compute);

/**
 * Drop every cached user. Called from the User model's write hooks, so it
 * fires for any save, update or delete no matter which controller did it.
 */
export const invalidateUsers = () => delPrefix(USERS_PREFIX);

export default { rememberUser, invalidateUsers };
