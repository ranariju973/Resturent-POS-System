/**
 * POS billing.
 *
 * ── The one rule everything else serves ────────────────────────────────────
 * The client sends item ids and quantities. Nothing else about money.
 *
 * Prices are read from the database at the moment of sale, snapshotted onto
 * the line, and every total is derived by `Order.recalculate()`. A tampered
 * price cannot get in: the validator has no field for it, the controller never
 * reads one, and the model's pre-validate hook refuses to save a document
 * whose totals do not follow from its lines. Three independent layers, and an
 * attacker has to defeat all three.
 *
 * ── Discounts are where the money actually leaks ───────────────────────────
 * Not through forged prices — through comps. A cashier who can zero any bill
 * can hand out free meals to friends indefinitely, and it reconciles perfectly
 * because the till agrees with the (discounted) orders. So discounts above a
 * ceiling, and voids of paid bills, need a second person: a manager taps an
 * override PIN, and `approvedBy` records who.
 */
import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Ticket } from '../models/Ticket.js';
import { Table } from '../models/Table.js';
import { MenuItem } from '../models/MenuItem.js';
import { Customer } from '../models/Customer.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { nextSequence } from '../models/Counter.js';
import {
  AUDIT_ACTION,
  ORDER_STATUS,
  ORDER_TYPE,
  TABLE_STATUS,
  TICKET_STATUS,
  DISCOUNT_TYPE,
} from '../constants/enums.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { can } from '../middleware/rbac.js';
import {
  CASHIER_MAX_DISCOUNT_PERCENT,
  CASHIER_MAX_DISCOUNT_MINOR,
  DEFAULT_TAX_RATE,
  CASHIER_VOID_WINDOW_MINUTES,
} from '../config/pos.js';
import { withTransaction } from '../utils/transaction.js';
import { announceNewTicket } from './kitchenController.js';
import { emitEvent, EVENTS } from '../utils/eventBus.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { toMajor, percentOf } from '../utils/money.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const publicOrder = (order) => ({
  id: String(order._id),
  orderNo: order.orderNo,
  type: order.type,
  status: order.status,
  table: order.table ? String(order.table) : null,
  customer: order.customer ? String(order.customer) : null,

  items: order.items.map((line) => ({
    id: String(line._id),
    menuItem: String(line.menuItem),
    name: line.nameSnapshot,
    qty: line.qty,
    note: line.note,
    unitPriceMinor: line.priceMinorAtSale,
    unitPrice: toMajor(line.priceMinorAtSale),
    lineTotalMinor: line.priceMinorAtSale * line.qty,
    lineTotal: toMajor(line.priceMinorAtSale * line.qty),
  })),

  subtotalMinor: order.subtotalMinor,
  subtotal: toMajor(order.subtotalMinor),
  discountType: order.discountType,
  discountValue: order.discountValue,
  discountMinor: order.discountMinor,
  discount: toMajor(order.discountMinor),
  taxRate: order.taxRate,
  taxMinor: order.taxMinor,
  tax: toMajor(order.taxMinor),
  totalMinor: order.totalMinor,
  total: toMajor(order.totalMinor),

  paymentMethod: order.paymentMethod,
  paidAt: order.paidAt,
  voidedAt: order.voidedAt,
  voidReason: order.voidReason,
  approvedBy: order.approvedBy ? String(order.approvedBy) : null,
  createdBy: String(order.createdBy),
  createdAt: order.createdAt,
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Turn the client's {menuItemId, qty, note} list into priced order lines.
 *
 * Every price here comes from the database. The request is consulted only for
 * *which* item and *how many*.
 *
 * @param {{menuItemId: string, qty: number, note: string}[]} requested
 * @param {import('mongoose').ClientSession|null} session
 */
async function priceLines(requested, session) {
  // Merge duplicate (item, note) pairs so the kitchen sees "3x Cold Brew"
  // rather than three separate tickets lines for the same thing.
  const merged = new Map();
  for (const line of requested) {
    const key = `${line.menuItemId}::${line.note ?? ''}`;
    const existing = merged.get(key);
    if (existing) existing.qty += line.qty;
    else merged.set(key, { ...line, note: line.note ?? '' });
  }

  const ids = [...new Set([...merged.values()].map((l) => l.menuItemId))];

  const found = await MenuItem.find({
    _id: mongoose.trusted({ $in: ids.map((id) => new mongoose.Types.ObjectId(id)) }),
    isActive: true,
  })
    .select('name priceMinor available isActive')
    .session(session ?? null);

  const byId = new Map(found.map((item) => [String(item._id), item]));

  const missing = [];
  const soldOut = [];
  const lines = [];

  for (const requestedLine of merged.values()) {
    const item = byId.get(requestedLine.menuItemId);

    if (!item) {
      missing.push(requestedLine.menuItemId);
      continue;
    }
    // Availability is re-checked server-side: the cart may have been sitting
    // on a terminal since before the kitchen ran out.
    if (!item.available) {
      soldOut.push(item.name);
      continue;
    }

    lines.push({
      menuItem: item._id,
      nameSnapshot: item.name,
      priceMinorAtSale: item.priceMinor, // <- the only source of price
      qty: requestedLine.qty,
      note: requestedLine.note,
    });
  }

  if (missing.length) {
    throw ApiError.badRequest(`${missing.length} item(s) on this order no longer exist`);
  }
  if (soldOut.length) {
    throw ApiError.conflict(`Sold out: ${soldOut.join(', ')}`);
  }

  return lines;
}

/** Human label for the kitchen board. */
const ticketSource = (type, table) => {
  if (type === ORDER_TYPE.DINE_IN && table) return `Table ${table.name}`;
  return type === ORDER_TYPE.TAKEAWAY ? 'Takeaway' : 'Delivery';
};

// ---------------------------------------------------------------------------
// POST /api/orders
// ---------------------------------------------------------------------------
/**
 * Place an order.
 *
 * Writes three documents — Order, Ticket, Table link — inside one transaction.
 * A partial success here is a broken restaurant: an order with no ticket means
 * the customer is charged and the kitchen never cooks; a ticket with no order
 * means food goes out unbilled.
 */
export const createOrder = asyncHandler(async (req, res) => {
  const { type, tableId, customerId, items: requestedItems } = req.body;

  let table = null;
  if (tableId) {
    table = await Table.findOne({ _id: tableId, isActive: true });
    if (!table) throw ApiError.badRequest('Table not found');
    if (table.currentOrder) {
      throw ApiError.conflict('That table already has an open bill');
    }
    if (table.mergedInto) {
      throw ApiError.conflict('That table is merged into another — bill the other table');
    }
  }

  if (customerId) {
    const exists = await Customer.exists({ _id: customerId, isActive: true });
    if (!exists) throw ApiError.badRequest('Customer not found');
  }

  const result = await withTransaction(async (session) => {
    const lines = await priceLines(requestedItems, session);
    const orderNo = await nextSequence('order', { session });

    const order = new Order({
      orderNo,
      type,
      table: table?._id ?? null,
      customer: customerId ?? null,
      items: lines,
      taxRate: DEFAULT_TAX_RATE,
      status: ORDER_STATUS.OPEN,
      createdBy: req.user.id,
    });
    order.recalculate();
    await order.save({ session });

    const ticket = new Ticket({
      order: order._id,
      no: orderNo,
      source: ticketSource(type, table),
      type,
      status: TICKET_STATUS.PENDING,
      placedAt: new Date(),
    });
    await ticket.save({ session });

    if (table) {
      // Atomic claim: the filter requires the table to still be free of a bill,
      // so two terminals opening a tab on the same table cannot both win.
      const claimed = await Table.findOneAndUpdate(
        { _id: table._id, isActive: true, currentOrder: null },
        {
          $set: {
            currentOrder: order._id,
            status: TABLE_STATUS.OCCUPIED,
            occupiedAt: table.occupiedAt ?? new Date(),
          },
        },
        { new: true, session },
      );

      if (!claimed) {
        // Inside a transaction this rolls back the order and ticket too.
        throw ApiError.conflict('That table was just billed by someone else');
      }
    }

    return { order, ticket };
  });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.ORDER_CREATE,
      resource: 'Order',
      resourceId: result.order._id,
      meta: {
        orderNo: result.order.orderNo,
        type,
        lines: result.order.items.length,
        totalMinor: result.order.totalMinor,
      },
    },
    req,
  );

  // Push the new ticket to connected boards. After the transaction committed,
  // so a board is never told about an order that was rolled back.
  announceNewTicket(result.ticket, result.order);

  return sendSuccess(
    res,
    { order: publicOrder(result.order), ticketId: String(result.ticket._id) },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// GET /api/orders
// ---------------------------------------------------------------------------
/**
 * List orders.
 *
 * A cashier sees today's orders only. Yesterday's takings are a reporting
 * question, and reporting is admin-only — letting the list endpoint page back
 * through history would route around that.
 */
export const listOrders = asyncHandler(async (req, res) => {
  const { status, type, tableId, customerId, from, to, limit, skip } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (tableId) filter.table = tableId;
  if (customerId) filter.customer = customerId;

  const seesEverything = can(req, PERMISSIONS.REPORTS_VIEW);

  if (seesEverything) {
    if (from || to) {
      const start = from ? new Date(from) : null;
      const end = to ? new Date(to) : null;
      if (start && end && start > end) throw ApiError.badRequest('`from` is after `to`');
      // A year cap keeps an unbounded range from forcing a collection scan.
      if (start && end && end - start > 366 * 24 * 3600 * 1000) {
        throw ApiError.badRequest('Date range must be one year or less');
      }
      filter.createdAt = mongoose.trusted({
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      });
    }
  } else {
    // Non-admins: today only, regardless of what was asked for.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    filter.createdAt = mongoose.trusted({ $gte: startOfDay });
  }

  const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);

  return sendSuccess(res, {
    orders: orders.map(publicOrder),
    count: orders.length,
    scope: seesEverything ? 'all' : 'today',
  });
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------
export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  return sendSuccess(res, { order: publicOrder(order) });
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/items
// ---------------------------------------------------------------------------
/**
 * Replace the lines on an open order — the cart being edited before payment.
 * Re-prices from the database every time, so a menu price change between
 * opening the tab and adding a round is picked up correctly.
 */
export const updateOrderItems = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!order.canBeModified()) {
    throw ApiError.conflict(`A ${order.status} order cannot be modified`);
  }

  const lines = await priceLines(req.body.items, null);
  order.items = lines;
  order.recalculate();
  await order.save();

  return sendSuccess(res, { order: publicOrder(order) });
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/discount
// ---------------------------------------------------------------------------
/**
 * Apply, change or clear a discount.
 *
 * The ceiling is checked against BOTH the percentage and the resulting cash
 * amount. A percentage limit alone is not enough — 20% of a large party's bill
 * is real money, and a fixed-amount discount sidesteps a percentage check
 * entirely.
 */
export const applyDiscount = asyncHandler(async (req, res) => {
  const { type, percent, valueMinor, adminOverridePin } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!order.canBeModified()) {
    throw ApiError.conflict(`A ${order.status} order cannot be discounted`);
  }

  // Clearing needs no authority beyond `pos:apply_discount`.
  if (type === null) {
    order.discountType = null;
    order.discountValue = 0;
    order.recalculate();
    await order.save();
    return sendSuccess(res, { order: publicOrder(order) });
  }

  // What the discount would actually cost, in cash.
  const costMinor =
    type === DISCOUNT_TYPE.PERCENT
      ? percentOf(order.subtotalMinor, percent)
      : Math.min(valueMinor, order.subtotalMinor);

  const overCeiling =
    (type === DISCOUNT_TYPE.PERCENT && percent > CASHIER_MAX_DISCOUNT_PERCENT) ||
    costMinor > CASHIER_MAX_DISCOUNT_MINOR;

  let approver = null;

  if (overCeiling && !can(req, PERMISSIONS.POS_OVERRIDE)) {
    approver = await resolveOverride(req, adminOverridePin, 'discount');

    if (!approver) {
      throw ApiError.forbidden(
        `Discounts above ${CASHIER_MAX_DISCOUNT_PERCENT}% or ` +
          `${toMajor(CASHIER_MAX_DISCOUNT_MINOR)} require manager approval`,
      );
    }
  }

  order.discountType = type;
  order.discountValue = type === DISCOUNT_TYPE.PERCENT ? percent : valueMinor;
  if (approver) order.approvedBy = approver._id;
  order.recalculate();
  await order.save();

  await AuditLog.record(
    {
      action: approver ? AUDIT_ACTION.ORDER_DISCOUNT_OVERRIDE : AUDIT_ACTION.ORDER_DISCOUNT_APPLIED,
      resource: 'Order',
      resourceId: order._id,
      meta: {
        orderNo: order.orderNo,
        type,
        percent: type === DISCOUNT_TYPE.PERCENT ? percent : undefined,
        discountMinor: order.discountMinor,
        approvedBy: approver ? String(approver._id) : undefined,
        approverName: approver?.name,
      },
    },
    req,
  );

  return sendSuccess(res, { order: publicOrder(order) });
});

// ---------------------------------------------------------------------------
// POST /api/orders/:id/pay
// ---------------------------------------------------------------------------
export const payOrder = asyncHandler(async (req, res) => {
  const { paymentMethod, customerId } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === ORDER_STATUS.PAID) throw ApiError.conflict('That bill is already paid');
  if (order.status === ORDER_STATUS.VOIDED) throw ApiError.conflict('That bill was voided');

  if (customerId) {
    const exists = await Customer.exists({ _id: customerId, isActive: true });
    if (!exists) throw ApiError.badRequest('Customer not found');
    order.customer = customerId;
  }

  await withTransaction(async (session) => {
    order.status = ORDER_STATUS.PAID;
    order.paymentMethod = paymentMethod;
    order.paidAt = new Date();
    await order.save({ session });

    // Free the table. Without this the table stays occupied forever and the
    // unique "one open order per table" index blocks the next party.
    if (order.table) {
      await Table.updateOne(
        { _id: order.table },
        {
          $set: { currentOrder: null, status: TABLE_STATUS.AVAILABLE, occupiedAt: null, mergedInto: null },
        },
        { session },
      );
      // Any table merged into this one is released with it.
      await Table.updateMany(
        { mergedInto: order.table },
        { $set: { mergedInto: null, status: TABLE_STATUS.AVAILABLE, occupiedAt: null } },
        { session },
      );
    }
  });

  // Denormalised counters — outside the transaction because a failure here
  // must not undo a completed payment.
  if (order.customer) {
    await Customer.updateOne(
      { _id: order.customer },
      { $set: { lastVisitAt: new Date() }, $inc: { visitCount: 1 } },
    ).catch((err) => logger.warn('Failed to update customer visit counters', { message: err.message }));
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.ORDER_PAY,
      resource: 'Order',
      resourceId: order._id,
      meta: { orderNo: order.orderNo, paymentMethod, totalMinor: order.totalMinor },
    },
    req,
  );

  return sendSuccess(res, { order: publicOrder(order) });
});

// ---------------------------------------------------------------------------
// POST /api/orders/:id/void
// ---------------------------------------------------------------------------
/**
 * Void a bill.
 *
 * An OPEN order can be voided by anyone holding `pos:create_order` — nothing
 * has been taken, so it is just abandoning a tab.
 *
 * A PAID order is different: money changed hands, and reversing that is the
 * classic till-skimming move. It needs `pos:void_order` (admin), or a
 * manager's override PIN at the terminal within a short window.
 */
export const voidOrder = asyncHandler(async (req, res) => {
  const { reason, adminOverridePin } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === ORDER_STATUS.VOIDED) throw ApiError.conflict('That bill is already voided');

  let approver = null;

  if (order.status === ORDER_STATUS.PAID && !can(req, PERMISSIONS.POS_VOID_ORDER)) {
    const minutesSincePaid = (Date.now() - new Date(order.paidAt).getTime()) / 60000;

    if (minutesSincePaid > CASHIER_VOID_WINDOW_MINUTES) {
      throw ApiError.forbidden(
        `A paid bill can only be voided by an administrator after ${CASHIER_VOID_WINDOW_MINUTES} minutes`,
      );
    }

    approver = await resolveOverride(req, adminOverridePin, 'void');
    if (!approver) throw ApiError.forbidden('Voiding a paid bill requires manager approval');
  }

  await withTransaction(async (session) => {
    order.status = ORDER_STATUS.VOIDED;
    order.voidedBy = req.user.id;
    order.voidedAt = new Date();
    order.voidReason = reason;
    if (approver) order.approvedBy = approver._id;
    await order.save({ session });

    // The kitchen must stop cooking. Served tickets stay as they are — the
    // food already went out, and rewriting that history would hide it.
    await Ticket.updateOne(
      { order: order._id, status: mongoose.trusted({ $ne: TICKET_STATUS.SERVED }) },
      { $set: { status: TICKET_STATUS.SERVED }, $push: { statusHistory: { status: TICKET_STATUS.SERVED, at: new Date(), by: req.user.id } } },
      { session },
    );

    if (order.table) {
      await Table.updateOne(
        { _id: order.table, currentOrder: order._id },
        { $set: { currentOrder: null, status: TABLE_STATUS.AVAILABLE, occupiedAt: null } },
        { session },
      );
    }
  });

  // Tell the boards to drop it — the kitchen must stop cooking.
  emitEvent(EVENTS.ORDER_VOIDED, { orderId: String(order._id), orderNo: order.orderNo });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.ORDER_VOID,
      resource: 'Order',
      resourceId: order._id,
      meta: {
        orderNo: order.orderNo,
        reason,
        wasPaid: Boolean(order.paidAt),
        totalMinor: order.totalMinor,
        approvedBy: approver ? String(approver._id) : undefined,
        approverName: approver?.name,
      },
    },
    req,
  );

  return sendSuccess(res, { order: publicOrder(order) });
});

// ---------------------------------------------------------------------------
// Manager override
// ---------------------------------------------------------------------------
/**
 * Resolve a manager's override PIN to the admin who owns it.
 *
 * Returns null on any failure — no PIN supplied, unknown PIN, wrong PIN. The
 * caller turns that into a generic 403, so this cannot be used to enumerate
 * which four-digit codes belong to a manager.
 *
 * Every attempt is audited, successful or not: a burst of failures at one
 * terminal is exactly the signal worth having.
 */
async function resolveOverride(req, pin, action) {
  if (!pin) return null;

  const admin = await User.findAdminByOverridePin(pin);
  const valid = admin ? await admin.verifyOverridePin(pin) : false;

  if (!valid) {
    logger.warn('Manager override rejected', {
      requestId: req.id,
      userId: req.user?.id,
      action,
      ip: req.ip,
    });
    await AuditLog.record(
      {
        action: AUDIT_ACTION.LOGIN_FAILURE,
        resource: 'Override',
        meta: { reason: 'bad-override-pin', attemptedAction: action },
      },
      req,
    );
    return null;
  }

  return admin;
}

export default {
  createOrder,
  listOrders,
  getOrder,
  updateOrderItems,
  applyDiscount,
  payOrder,
  voidOrder,
};
