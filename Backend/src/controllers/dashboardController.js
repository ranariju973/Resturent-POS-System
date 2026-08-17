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

/** Local midnight — the service day as staff experience it, not UTC. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const startOfMonth = (offset = 0) => {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

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

/** The recent-orders table. Same for both roles — it is today's own work. */
async function recentOrders(since, limit = 10) {
  const orders = await Order.find({ createdAt: mongoose.trusted({ $gte: since }) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('orderNo type status totalMinor createdAt items');

  return orders.map((o) => ({
    id: String(o._id),
    orderNo: o.orderNo,
    type: o.type,
    status: o.status,
    totalMinor: o.totalMinor,
    total: toMajor(o.totalMinor),
    itemCount: o.items.reduce((sum, l) => sum + l.qty, 0),
    createdAt: o.createdAt,
  }));
}

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
  return sendSuccess(res, await rememberDashboard(scope, () => buildDashboard(scope)));
});

async function buildDashboard(scope) {
  const since = startOfToday();

  const [today, pending, completed, recent] = await Promise.all([
    takings(since),
    Ticket.countDocuments({ status: TICKET_STATUS.PENDING }),
    Ticket.countDocuments({
      status: TICKET_STATUS.SERVED,
      updatedAt: mongoose.trusted({ $gte: since }),
    }),
    recentOrders(since),
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
      recentOrders: recent,
    };
  }

  // --- The full payload -----------------------------------------------------
  const monthStart = startOfMonth(0);
  const prevMonthStart = startOfMonth(-1);

  const [thisMonth, prevMonth, expenseRow, topItems] = await Promise.all([
    takings(monthStart),
    takings(prevMonthStart, monthStart),
    Expense.aggregate([
      { $match: { isActive: true, date: mongoose.trusted({ $gte: monthStart }) } },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' } } },
    ]).then(([r]) => r?.totalMinor ?? 0),
    Order.aggregate([
      { $match: { status: ORDER_STATUS.PAID, paidAt: mongoose.trusted({ $gte: monthStart }) } },
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
    recentOrders: recent,

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
