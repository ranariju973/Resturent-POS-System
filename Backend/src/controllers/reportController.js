/**
 * Reports. Admin only, without exception.
 *
 * ── Aggregation happens in MongoDB, not in Node ────────────────────────────
 * Every figure here is produced by a pipeline. The alternative — fetching the
 * month's orders and reducing them in JavaScript — works fine on the seed data
 * and falls over in year two, when "this month" is fifty thousand documents
 * being pulled across the wire to compute one number.
 *
 * ── Voided orders are excluded, deliberately and visibly ───────────────────
 * Every revenue figure matches on `status: 'paid'`. A voided order is not
 * revenue. But the void COUNT is reported alongside, because a day with
 * fourteen voids is worth an owner's attention even when the takings look
 * normal — that pattern is what till-skimming looks like from the outside.
 */
import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Expense } from '../models/Expense.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, ORDER_STATUS, EXPENSE_CATEGORY_VALUES } from '../constants/enums.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { toMajor } from '../utils/money.js';
import { todayIso, dayStart, dayEnd } from '../utils/date.js';
import { rememberDailyReport, rememberMonthlyReport } from '../utils/statsCache.js';

/** Longest span any range query may cover. */
const MAX_RANGE_DAYS = 366;

// Moved to utils/date.js so the stats cache can share the same definition of
// "today" — see the note there about server local time.

/**
 * Resolve an optional range to concrete bounds, refusing anything unbounded.
 * The schema already rejects from > to; this enforces the SPAN.
 */
function resolveRange(from, to) {
  const end = to ? dayEnd(to) : dayEnd(todayIso());
  const start = from ? dayStart(from) : new Date(end.getTime() - 30 * 864e5);

  if (end - start > MAX_RANGE_DAYS * 864e5) {
    throw ApiError.badRequest(`Date range must be ${MAX_RANGE_DAYS} days or less`);
  }
  return { start, end };
}

const paidBetween = (start, end) => ({
  status: ORDER_STATUS.PAID,
  paidAt: mongoose.trusted({ $gte: start, $lt: end }),
});

// ---------------------------------------------------------------------------
// GET /api/reports/daily
// ---------------------------------------------------------------------------
export const dailyReport = asyncHandler(async (req, res) => {
  const date = req.query.date ?? todayIso();
  return sendSuccess(res, await rememberDailyReport(date, () => buildDailyReport(date)));
});

async function buildDailyReport(date) {
  const start = dayStart(date);
  const end = dayEnd(date);

  /*
   * ── One pass, not six ──────────────────────────────────────────────────
   * These five figures are all different groupings of the SAME set of paid
   * orders. Run as separate pipelines they were five independent passes over
   * that set — five index seeks and five scans to answer one screen.
   *
   * $facet fans one stream of matched documents out to every sub-pipeline, so
   * the $match runs once. It stays in front of the $facet deliberately:
   * $facet cannot use an index itself, so the match has to narrow the set
   * first — which is exactly what the {status:1, paidAt:-1} index is for.
   *
   * The void count is NOT in here. It matches on a different status and on
   * voidedAt, so it has nothing to share with the others and would have to
   * widen the match to be folded in.
   */
  const [grouped, voided] = await Promise.all([
    Order.aggregate([
      { $match: paidBetween(start, end) },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                grossMinor: { $sum: '$subtotalMinor' },
                discountMinor: { $sum: '$discountMinor' },
                taxMinor: { $sum: '$taxMinor' },
                netMinor: { $sum: '$totalMinor' },
                orders: { $sum: 1 },
              },
            },
          ],
          byPayment: [
            { $group: { _id: '$paymentMethod', totalMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
            { $sort: { totalMinor: -1 } },
          ],
          byHour: [
            { $group: { _id: { $hour: '$paidAt' }, totalMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          byType: [{ $group: { _id: '$type', totalMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } }],
          topItems: [
            { $unwind: '$items' },
            {
              $group: {
                _id: '$items.nameSnapshot',
                qty: { $sum: '$items.qty' },
                revenueMinor: { $sum: { $multiply: ['$items.priceMinorAtSale', '$items.qty'] } },
              },
            },
            { $sort: { qty: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]).then(([r]) => r ?? {}),

    Order.countDocuments({
      status: ORDER_STATUS.VOIDED,
      voidedAt: mongoose.trusted({ $gte: start, $lt: end }),
    }),
  ]);

  // $facet always returns one document whose every key is an array, so an
  // empty day gives empty arrays rather than undefined — but a day with no
  // orders at all yields no document, hence the ?? on each.
  const totals = grouped.totals?.[0] ?? {};
  const byPayment = grouped.byPayment ?? [];
  const byHour = grouped.byHour ?? [];
  const byType = grouped.byType ?? [];
  const topItems = grouped.topItems ?? [];

  return {
    date,
    grossMinor: totals.grossMinor ?? 0,
    gross: toMajor(totals.grossMinor ?? 0),
    discountMinor: totals.discountMinor ?? 0,
    discount: toMajor(totals.discountMinor ?? 0),
    taxMinor: totals.taxMinor ?? 0,
    netMinor: totals.netMinor ?? 0,
    net: toMajor(totals.netMinor ?? 0),
    orders: totals.orders ?? 0,
    averageOrderMinor: totals.orders ? Math.round(totals.netMinor / totals.orders) : 0,
    voidedOrders: voided,
    byPaymentMethod: byPayment.map((p) => ({
      method: p._id ?? 'unrecorded',
      totalMinor: p.totalMinor,
      total: toMajor(p.totalMinor),
      orders: p.orders,
    })),
    byOrderType: byType.map((p) => ({
      type: p._id,
      totalMinor: p.totalMinor,
      total: toMajor(p.totalMinor),
      orders: p.orders,
    })),
    // Every hour present, so the chart has no gaps to guess at.
    hourly: Array.from({ length: 24 }, (_, hour) => {
      const row = byHour.find((h) => h._id === hour);
      return { hour, totalMinor: row?.totalMinor ?? 0, orders: row?.orders ?? 0 };
    }),
    topItems: topItems.map((i) => ({
      name: i._id,
      qty: i.qty,
      revenueMinor: i.revenueMinor,
      revenue: toMajor(i.revenueMinor),
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /api/reports/monthly
// ---------------------------------------------------------------------------
export const monthlyReport = asyncHandler(async (req, res) => {
  const month = req.query.month ?? todayIso().slice(0, 7);
  return sendSuccess(res, await rememberMonthlyReport(month, () => buildMonthlyReport(month)));
});

async function buildMonthlyReport(month) {
  const start = new Date(`${month}-01T00:00:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const prevStart = new Date(start);
  prevStart.setMonth(prevStart.getMonth() - 1);

  /*
   * Three of these five read the same month of paid orders, so they share one
   * pass via $facet — see dailyReport for the reasoning. The other two cannot
   * join it: `prev` matches a different month, and `expenses` is a different
   * collection entirely.
   */
  const [grouped, prev, expenses] = await Promise.all([
    Order.aggregate([
      { $match: paidBetween(start, end) },
      {
        $facet: {
          totals: [{ $group: { _id: null, netMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } }],
          daily: [
            {
              $group: {
                _id: { $dayOfMonth: '$paidAt' },
                totalMinor: { $sum: '$totalMinor' },
                orders: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          // The same grouping the daily report does, over the month's bounds.
          // The monthly tab used to borrow the DAILY split, which showed one
          // day's figures under a monthly heading whenever it showed anything.
          byPayment: [
            { $group: { _id: '$paymentMethod', totalMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
            { $sort: { totalMinor: -1 } },
          ],
        },
      },
    ]).then(([r]) => r ?? {}),

    Order.aggregate([
      { $match: paidBetween(prevStart, start) },
      { $group: { _id: null, netMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
    ]).then(([r]) => r ?? { netMinor: 0, orders: 0 }),

    Expense.aggregate([
      { $match: { isActive: true, date: mongoose.trusted({ $gte: start, $lt: end }) } },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' } } },
    ]).then(([r]) => r?.totalMinor ?? 0),
  ]);

  const totals = grouped.totals?.[0] ?? { netMinor: 0, orders: 0 };
  const daily = grouped.daily ?? [];
  const byPayment = grouped.byPayment ?? [];

  const daysInMonth = new Date(end.getTime() - 864e5).getDate();
  const netMinor = totals.netMinor ?? 0;

  return {
    month,
    netMinor,
    net: toMajor(netMinor),
    orders: totals.orders ?? 0,
    expensesMinor: expenses,
    expenses: toMajor(expenses),
    profitMinor: netMinor - expenses,
    profit: toMajor(netMinor - expenses),
    prevMonthNetMinor: prev.netMinor ?? 0,
    changePercent:
      prev.netMinor > 0
        ? Number((((netMinor - prev.netMinor) / prev.netMinor) * 100).toFixed(1))
        : null,
    daily: Array.from({ length: daysInMonth }, (_, i) => {
      const row = daily.find((d) => d._id === i + 1);
      return { day: i + 1, totalMinor: row?.totalMinor ?? 0, orders: row?.orders ?? 0 };
    }),
    // Same shape as the daily report's, so one client component renders both.
    byPaymentMethod: byPayment.map((p) => ({
      method: p._id ?? 'unrecorded',
      totalMinor: p.totalMinor,
      total: toMajor(p.totalMinor),
      orders: p.orders,
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /api/reports/pnl
// ---------------------------------------------------------------------------
export const profitAndLoss = asyncHandler(async (req, res) => {
  const { start, end } = resolveRange(req.query.from, req.query.to);

  const [revenue, byCategory] = await Promise.all([
    Order.aggregate([
      { $match: paidBetween(start, end) },
      {
        $group: {
          _id: null,
          grossMinor: { $sum: '$subtotalMinor' },
          discountMinor: { $sum: '$discountMinor' },
          netMinor: { $sum: '$totalMinor' },
          orders: { $sum: 1 },
        },
      },
    ]).then(([r]) => r ?? {}),

    Expense.aggregate([
      { $match: { isActive: true, date: mongoose.trusted({ $gte: start, $lt: end }) } },
      { $group: { _id: '$category', totalMinor: { $sum: '$amountMinor' } } },
      { $sort: { totalMinor: -1 } },
    ]),
  ]);

  const netMinor = revenue.netMinor ?? 0;
  const expensesMinor = byCategory.reduce((sum, c) => sum + c.totalMinor, 0);
  const profitMinor = netMinor - expensesMinor;

  return sendSuccess(res, {
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - 864e5).toISOString().slice(0, 10),
    revenue: {
      grossMinor: revenue.grossMinor ?? 0,
      gross: toMajor(revenue.grossMinor ?? 0),
      discountMinor: revenue.discountMinor ?? 0,
      discount: toMajor(revenue.discountMinor ?? 0),
      netMinor,
      net: toMajor(netMinor),
      orders: revenue.orders ?? 0,
    },
    expenses: {
      totalMinor: expensesMinor,
      total: toMajor(expensesMinor),
      // Every category present, including the ones at zero — an absent row
      // reads as missing data rather than as "nothing was spent".
      byCategory: EXPENSE_CATEGORY_VALUES.map((category) => {
        const row = byCategory.find((c) => c._id === category);
        return {
          category,
          totalMinor: row?.totalMinor ?? 0,
          total: toMajor(row?.totalMinor ?? 0),
        };
      }),
    },
    profitMinor,
    profit: toMajor(profitMinor),
    marginPercent: netMinor > 0 ? Number(((profitMinor / netMinor) * 100).toFixed(1)) : null,
  });
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export const listExpenses = asyncHandler(async (req, res) => {
  const { from, to, category, limit, skip } = req.query;
  const { start, end } = resolveRange(from, to);

  const filter = {
    isActive: true,
    date: mongoose.trusted({ $gte: start, $lt: end }),
    ...(category ? { category } : {}),
  };

  const [expenses, total, sum] = await Promise.all([
    Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
    Expense.countDocuments(filter),
    Expense.aggregate([
      { $match: filter },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' } } },
    ]).then(([r]) => r?.totalMinor ?? 0),
  ]);

  return sendSuccess(res, {
    expenses: expenses.map((e) => ({
      id: String(e._id),
      date: e.date,
      category: e.category,
      description: e.description,
      amountMinor: e.amountMinor,
      amount: toMajor(e.amountMinor),
    })),
    total,
    totalMinor: sum,
    totalAmount: toMajor(sum),
    limit,
    skip,
    hasMore: skip + expenses.length < total,
  });
});

export const createExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.create({
    ...req.body,
    date: new Date(`${req.body.date}T00:00:00`),
    createdBy: req.user.id,
  });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.EXPENSE_CREATE,
      resource: 'Expense',
      resourceId: expense._id,
      meta: { category: expense.category, amountMinor: expense.amountMinor },
    },
    req,
  );

  return sendSuccess(
    res,
    {
      expense: {
        id: String(expense._id),
        date: expense.date,
        category: expense.category,
        description: expense.description,
        amountMinor: expense.amountMinor,
        amount: toMajor(expense.amountMinor),
      },
    },
    { status: 201 },
  );
});

/**
 * Hard delete. Nothing references an expense — it is a leaf record — so there
 * is no integrity guard here, only the audit trail.
 *
 * Worth knowing: a deleted expense changes a P&L that someone may already have
 * read. The row is gone, so the audit entry below carries the full amount and
 * category and is the only surviving record that the cost was ever booked.
 */
export const deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) throw ApiError.notFound('Expense not found');

  const snapshot = {
    category: expense.category,
    amountMinor: expense.amountMinor,
    date: expense.date,
    description: expense.description,
  };

  await Expense.deleteOne({ _id: expense._id });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.EXPENSE_DELETE,
      resource: 'Expense',
      resourceId: expense._id,
      meta: snapshot,
    },
    req,
  );

  return sendSuccess(res, { deleted: true, id: String(expense._id) });
});

export default {
  dailyReport,
  monthlyReport,
  profitAndLoss,
  listExpenses,
  createExpense,
  deleteExpense,
};
