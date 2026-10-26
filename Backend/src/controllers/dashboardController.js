/**
 * Dashboard.
 *
 * ── One endpoint, two payloads ─────────────────────────────────────────────
 * This is where the cashier restriction from the original brief finally shows
 * up in a response body rather than as a permission.
 *
 * A cashier gets exactly the four cards their screen already renders — today's
 * sales, today's orders, pending, completed — plus the recent-orders table.
 * An admin additionally gets period comparisons, expense totals, margin and
 * best-selling items.
 *
 * ── Why the difference is built this way ───────────────────────────────────
 * Three decisions, each closing a different hole:
 *
 *   1. The two grants are SEPARATE PERMISSIONS (`dashboard:view:full` and
 *      `dashboard:view:limited`), not one permission plus a flag. A flag is a
 *      conditional somebody eventually gets backwards.
 *
 *   2. The shape is chosen by `dashboardScopeFor(role)`, never by comparing
 *      `role === 'admin'` here. All authorisation logic stays in one file.
 *
 *   3. The limited payload is BUILT SEPARATELY — it is not the full payload
 *      with fields deleted. Deleting from a rich object is how a new field
 *      added next year silently reaches a cashier: whoever adds it has to
 *      remember to also add it to a redaction list, and eventually nobody
 *      does. Here, a new admin metric is invisible to cashiers unless someone
 *      deliberately writes it into the limited branch too.
 *
 * The endpoint also accepts NO query parameters (see the validator), so
 * "today" is not a default that a `?range=month` could override.
 */
import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Ticket } from '../models/Ticket.js';
import { Expense } from '../models/Expense.js';
import { ORDER_STATUS, TICKET_STATUS } from '../constants/enums.js';
import { dashboardScopeFor } from '../constants/permissions.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { toMajor } from '../utils/money.js';
import { rememberDashboard } from '../utils/statsCache.js';

import { todayIso, dayStart, monthStart, serviceWindow } from '../utils/date.js';
import { liveTicketFilter } from '../utils/ticketExpiry.js';

/** Paid takings and order count over a window. */
async function takings(since, until) {
  const match = {
    status: ORDER_STATUS.PAID,
    paidAt: mongoose.trusted({ $gte: since, ...(until ? { $lt: until } : {}) }),
  };
  const [row] = await Order.aggregate([
    { $match: match },
    { $group: { _id: null, salesMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
  ]);
  return { salesMinor: row?.salesMinor ?? 0, orders: row?.orders ?? 0 };
}

/** Stable descending pagination; the server always controls the allowed window. */
export async function recentOrders(cursor, now = new Date()) {
  const { recentSince, nextResetAt } = serviceWindow(now);
  const filter = { createdAt: mongoose.trusted({ $gte: recentSince, $lte: now }) };
  if (cursor) {
    const [time, id, window] = cursor.split('_');
    if (Number(window) !== recentSince.getTime()) {
      throw ApiError.conflict('The service day changed. Refresh recent orders.');
    }
    const at = new Date(Number(time));
    if (!Number.isFinite(at.getTime()) || at < recentSince || at > now) {
      throw ApiError.badRequest('Invalid recent-orders cursor');
    }
    filter.$or = [
      { createdAt: mongoose.trusted({ $lt: at }) },
      { createdAt: at, _id: mongoose.trusted({ $lt: new mongoose.Types.ObjectId(id) }) },
    ];
  }
  const found = await Order.find(filter)
    .sort({ createdAt: -1, _id: -1 }).limit(51)
    .select('orderNo type status totalMinor createdAt items.qty').lean();
  const rows = found.slice(0, 50);
  const last = rows.at(-1);
  return {
    recentOrders: rows.map((o) => ({
      id: String(o._id), orderNo: o.orderNo, type: o.type, status: o.status,
      totalMinor: o.totalMinor, total: toMajor(o.totalMinor),
      itemCount: o.items.reduce((sum, l) => sum + l.qty, 0), createdAt: o.createdAt,
    })),
    recentNextCursor: found.length > 50
      ? `${last.createdAt.getTime()}_${last._id}_${recentSince.getTime()}` : null,
    recentSince,
    nextResetAt,
  };
}

export const getRecentOrders = asyncHandler(async (req, res) => {
  return sendSuccess(res, await recentOrders(req.query.cursor));
});

// ---------------------------------------------------------------------------
// GET /api/dashboard
// ---------------------------------------------------------------------------
export const getDashboard = asyncHandler(async (req, res) => {
  const scope = dashboardScopeFor(req.user.role);
  if (!scope) throw ApiError.forbidden('Insufficient permissions');

  /*
   * Cached for 30 seconds, keyed by SCOPE rather than by user.
   *
   * The scope is derived entirely from the role and decides which of the two
   * payloads gets built, so every cashier shares one entry and no cashier can
   * ever be served the admin's wider one. Keying by user id instead would be
   * a key per staff member for identical data — and, on the admin path, eight
   * aggregations repeated per person.
   *
   * 30 seconds is short on purpose: these are takings, and a dashboard that
   * lags a sale by half a minute is acceptable where one that lags by five is
   * not. See utils/statsCache.js for why there is no invalidate-on-payment.
   */
  let data = await rememberDashboard(scope, () => buildDashboard(scope));
  if (new Date(data.nextResetAt).getTime() <= Date.now()) {
    data = await rememberDashboard(scope, () => buildDashboard(scope));
  }
  return sendSuccess(res, data);
});

async function buildDashboard(scope) {
  const now = new Date();
  const since = dayStart(todayIso(now));
  const live = liveTicketFilter(now);

  const [today, pending, completed, recent] = await Promise.all([
    takings(since),
    Ticket.countDocuments({ ...live, status: TICKET_STATUS.PENDING }),
    Ticket.countDocuments({
      ...live, status: TICKET_STATUS.SERVED,
    }),
    recentOrders(undefined, now),
  ]);

  // --- The limited payload, built from scratch ------------------------------
  if (scope === 'limited') {
    return {
      scope,
      todaySalesMinor: today.salesMinor,
      todaySales: toMajor(today.salesMinor),
      todayOrders: today.orders,
      pendingOrders: pending,
      completedOrders: completed,
      recentOrders: recent.recentOrders,
      recentNextCursor: recent.recentNextCursor,
      recentSince: recent.recentSince,
      nextResetAt: recent.nextResetAt,
    };
  }

  // --- The full payload -----------------------------------------------------
  const thisMonthStart = monthStart(todayIso(now).slice(0, 7));
  const prevMonthStart = monthStart(todayIso(now).slice(0, 7), -1);

  const [thisMonth, prevMonth, expenseRow, topItems] = await Promise.all([
    takings(thisMonthStart),
    takings(prevMonthStart, thisMonthStart),
    Expense.aggregate([
      { $match: { isActive: true, date: mongoose.trusted({ $gte: thisMonthStart }) } },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' } } },
    ]).then(([r]) => r?.totalMinor ?? 0),
    Order.aggregate([
      { $match: { status: ORDER_STATUS.PAID, paidAt: mongoose.trusted({ $gte: thisMonthStart }) } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.nameSnapshot',
          qty: { $sum: '$items.qty' },
          revenueMinor: { $sum: { $multiply: ['$items.priceMinorAtSale', '$items.qty'] } },
        },
      },
      { $sort: { qty: -1 } },
      { $limit: 8 },
    ]),
  ]);

  const grossMinor = thisMonth.salesMinor;
  const netMinor = grossMinor - expenseRow;

  return {
    scope,
    todaySalesMinor: today.salesMinor,
    todaySales: toMajor(today.salesMinor),
    todayOrders: today.orders,
    pendingOrders: pending,
    completedOrders: completed,
    ...recent,

    // Admin-only from here down.
    monthSalesMinor: grossMinor,
    monthSales: toMajor(grossMinor),
    monthOrders: thisMonth.orders,
    prevMonthSalesMinor: prevMonth.salesMinor,
    prevMonthSales: toMajor(prevMonth.salesMinor),
    // Null rather than 0 when there is no prior month: "no change" and "no
    // basis for comparison" are different facts, and a 0 would be read as the
    // first of them.
    salesChangePercent:
      prevMonth.salesMinor > 0
        ? Number((((grossMinor - prevMonth.salesMinor) / prevMonth.salesMinor) * 100).toFixed(1))
        : null,
    monthExpensesMinor: expenseRow,
    monthExpenses: toMajor(expenseRow),
    monthNetMinor: netMinor,
    monthNet: toMajor(netMinor),
    marginPercent: grossMinor > 0 ? Number(((netMinor / grossMinor) * 100).toFixed(1)) : null,
    topItems: topItems.map((i) => ({
      name: i._id,
      qty: i.qty,
      revenueMinor: i.revenueMinor,
      revenue: toMajor(i.revenueMinor),
    })),
  };
}

export default { getDashboard };
