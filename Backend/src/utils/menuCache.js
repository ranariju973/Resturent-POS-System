/**
 * Menu caching, and the one function every menu writer calls to drop it.
 *
 * The menu is the most-read and least-written thing in the system: every till
 * loads it on boot and after every refresh, and it changes when someone edits
 * the menu — weekly, not hourly. That is the shape a cache is for.
 *
 * ── Why only the unfiltered read is cached ─────────────────────────────────
 * GET /api/menu/items takes category, available, search, limit and
 * includeInactive. Caching each combination would mean a key per distinct
 * search term, and search terms come from whatever a user types — an unbounded
 * key space in a Map with no eviction, which is a memory leak that only shows
 * up under real traffic.
 *
 * So exactly one shape is cached: the no-filters read. That is the one the POS
 * actually makes on every page load. A filtered or searched request skips the
 * cache and queries directly, which is correct and costs nothing extra,
 * because those come from the menu-management screen rather than the till.
 *
 * ── Why invalidation, not a short TTL ──────────────────────────────────────
 * The stock toggle marks an item sold out mid-service. Waiting out a TTL would
 * leave other terminals offering food the kitchen has run out of. Every writer
 * calls invalidateMenu(), so a change is visible on the next read.
 *
 * The order path re-checks availability against the database at bill time
 * regardless, so a stale menu can never actually sell a sold-out item — the
 * worst case is a cashier being told at the till instead of seeing it greyed
 * out. That backstop is why a five-minute TTL is a safe ceiling rather than a
 * gamble.
 */
import { key, del, remember } from './cache.js';

const TTL_MS = 5 * 60_000;

export const MENU_ITEMS_KEY = key('menu', 'items');
export const MENU_CATEGORIES_KEY = key('menu', 'categories');

/** True when a request asked for the plain, whole, live menu. */
export function isCacheableItemQuery(query) {
  return (
    !query.category &&
    !query.search &&
    query.available === undefined &&
    query.includeInactive !== 'true'
  );
}

export const rememberItems = (compute) => remember(MENU_ITEMS_KEY, TTL_MS, compute);
export const rememberCategories = (compute) => remember(MENU_CATEGORIES_KEY, TTL_MS, compute);

/**
 * Called by every menu and category writer.
 *
 * Both keys go together on purpose: a category list carries per-category item
 * counts, so creating an item changes the categories payload too. Dropping
 * only the one that "obviously" changed is how counts drift.
 */
export async function invalidateMenu() {
  await Promise.all([del(MENU_ITEMS_KEY), del(MENU_CATEGORIES_KEY)]);
}

export default { rememberItems, rememberCategories, invalidateMenu, isCacheableItemQuery };
