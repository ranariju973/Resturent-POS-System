/**
 * Caching for the dashboard and the reports — the read-heavy screens.
 *
 * These are different from the menu in one way that matters: they are money
 * figures, and a stale number on a takings screen is worse than a slow one.
 * So the TTLs here are short and chosen per payload rather than set once.
 *
 * ── Why no invalidate-on-payment hook ──────────────────────────────────────
 * The obvious design is to drop these whenever an order is paid or voided.
 * It was considered and rejected: during service a payment happens every few
 * minutes, so the cache would be invalidated far more often than it was read,
 * and the hit rate would approach zero. All that would remain is the
 * complexity — an invalidation call in payOrder, voidOrder, deleteOrder and
 * every expense writer, each one a place to forget.
 *
 * A short TTL gets the same benefit (a burst of loads costs one query) with
 * bounded, predictable staleness and no coupling to the money path.
 *
 * ── Why today and the past are cached differently ──────────────────────────
 * A report for a day that has ended is effectively immutable — nothing new
 * will be billed to it. It can be held for minutes safely.
 *
 * Today's report is still being written to with every sale, so it gets the
 * same short window as the dashboard. Voiding an order from a past day does
 * change history, which is why even the historical TTL is minutes and not
 * hours.
 *
 * Nothing here is keyed by anything a user invents: dates and roles only. See
 * the warning in cache.js about unbounded keys.
 */
import { key, remember, delPrefix } from './cache.js';
import { todayIso } from './date.js';

/** A screen someone is watching while money moves. Kept deliberately short. */
const LIVE_TTL_MS = 30_000;

/** A day that has already ended. */
const HISTORICAL_TTL_MS = 5 * 60_000;

const STATS_PREFIX = key('stats');

/**
 * Per role, not per user: dashboardScopeFor() returns one of two payloads
 * decided entirely by role, so two cashiers share an entry and an admin never
 * sees the cashier's narrower one.
 */
export const rememberDashboard = (role, compute) =>
  remember(key('stats', 'dashboard', role), LIVE_TTL_MS, compute);

export const rememberDailyReport = (date, compute) =>
  remember(
    key('stats', 'report', 'daily', date),
    date === todayIso() ? LIVE_TTL_MS : HISTORICAL_TTL_MS,
    compute,
  );

export const rememberMonthlyReport = (month, compute) =>
  remember(
    key('stats', 'report', 'monthly', month),
    month === todayIso().slice(0, 7) ? LIVE_TTL_MS : HISTORICAL_TTL_MS,
    compute,
  );

/**
 * Drop every cached figure. Not called on the money path by design (see
 * above) — this exists for tests and for an admin-facing "refresh now" if one
 * is ever added.
 */
export const invalidateStats = () => delPrefix(STATS_PREFIX);

export default {
  rememberDashboard,
  rememberDailyReport,
  rememberMonthlyReport,
  invalidateStats,
};
