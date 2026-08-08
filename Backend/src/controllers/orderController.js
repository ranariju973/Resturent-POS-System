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
import {
  Order,
  formatInvoiceNo,
  mintInvoiceToken,
  hashInvoiceToken,
} from '../models/Order.js';
import { Ticket } from '../models/Ticket.js';
import { Table } from '../models/Table.js';
import { MenuItem } from '../models/MenuItem.js';
import { Customer, normalizePhone } from '../models/Customer.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { nextSequence, nextSequenceWithDay } from '../models/Counter.js';
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
import { buildInvoiceUrl } from '../utils/invoiceLink.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const publicOrder = (order) => ({
  id: String(order._id),
  orderNo: order.orderNo,
  // Assigned at creation, so the till can print a bill before payment.
  invoiceNo: order.invoiceNo ?? null,
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

/**
 * Find or create the customer captured at the till, keyed by phone.
 *
 * ── Why the phone and not the name ─────────────────────────────────────────
 * Names collide and get typed differently every visit; a phone number is the
 * one field a customer will give identically each time, and the model already
 * enforces uniqueness on its normalised form. So the number decides identity
 * and the name is just a label hanging off it.
 *
 * ── Why an existing name is never overwritten ──────────────────────────────
 * If the number is known, whatever the cashier typed in the name box is
 * ignored. A busy till produces typos, and a typo must not be allowed to
 * rename a regular — worse, to rename them differently at each terminal. Names
 * are corrected deliberately, on the Customers screen.
 *
 * ── Why an unknown number with no name is refused ──────────────────────────
 * The alternative is filing them as "Guest", and a customer list that is
 * mostly Guests is not a customer list. Four characters at the till is the
 * cheaper cost.
 *
 * @returns {Promise<import('mongoose').Types.ObjectId|null>}
 */
async function resolveInlineCustomer(inline, req, session) {
  if (!inline) return null;

  const digits = normalizePhone(inline.phone);
  const name = inline.name?.trim();

  // Soft-deleted records are matched too: a number that was removed and is now
  // being used again should revive that customer rather than collide with the
  // unique index it still occupies.
  const existing = await Customer.findOne({ phoneNormalized: digits })
    .select('+phoneNormalized name isActive')
    .session(session ?? null);

  if (existing) {
    if (!existing.isActive) {
      existing.isActive = true;
      if (name) existing.name = name;
      await existing.save({ session });
    }
    return existing._id;
  }

  if (!name) {
    throw ApiError.badRequest('This number is new — please enter the customer’s name');
  }

  const created = new Customer({ name, phone: inline.phone });
  await created.save({ session });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.CUSTOMER_CREATE,
      resource: 'Customer',
      resourceId: created._id,
      // No phone or name in the meta — the logger redacts those fields, and an
      // audit trail is not an exemption from that.
      meta: { via: 'billing' },
    },
    req,
  );

  return created._id;
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
  const { type, tableId, customerId, customer: inline, items: requestedItems } = req.body;

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
    // The day comes back with the sequence so the invoice number and the
    // counter that produced it cannot disagree across a midnight boundary.
    const { seq: orderNo, day } = await nextSequenceWithDay('order', { session });

    // Resolve the customer inside the transaction, so a record is never left
    // behind by an order that then failed to save.
    const resolvedCustomerId = customerId ?? (await resolveInlineCustomer(inline, req, session));

    const order = new Order({
      orderNo,
      // Assigned here rather than at payment so the number is stable from the
      // moment the bill exists — a reprint or a support call can quote it. The
      // shareable LINK is a separate thing, minted at payment.
      invoiceNo: formatInvoiceNo(day, orderNo),
      type,
      table: table?._id ?? null,
      customer: resolvedCustomerId ?? null,
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

  /**
   * Minted here rather than at creation, and the reason is not stylistic.
   *
   * Only the HASH is stored, so a later request can never reconstruct the raw
   * token — this is the one moment it exists in memory, and the one response
   * that can carry it. Doing it at payment also means a bill voided before it
   * was ever settled has no shareable link at all, which is exactly right.
   */
  const invoiceToken = mintInvoiceToken();

  // Read before the response is built. `order.customer` is an id, and the
  // client may only ever have held a masked form of the number.
  const customerPhone = order.customer
    ? (await Customer.findById(order.customer).select('+phoneNormalized phone'))?.phone ?? null
    : null;

  await withTransaction(async (session) => {
    order.status = ORDER_STATUS.PAID;
    order.paymentMethod = paymentMethod;
    order.paidAt = new Date();
    order.invoiceTokenHash = hashInvoiceToken(invoiceToken);
    await order.save({ session });

    /**
     * Release the BILL, but not the table.
     *
     * `currentOrder` must be cleared or the unique "one open order per table"
     * index blocks the next party forever. The status is a different question:
     * paying does not make a party stand up. They are still sitting there with
     * their coffee, and a floor plan that turns the table green the instant the
     * card is tapped tells the host a table is free that is not.
     *
     * So the table stays OCCUPIED until somebody explicitly clears it — the
     * release endpoint, which is what the "clear" action on the floor calls.
     * `occupiedAt` is kept for the same reason: the elapsed timer should keep
     * running while the table is still held.
     */
    if (order.table) {
      await Table.updateOne(
        { _id: order.table },
        { $set: { currentOrder: null, mergedInto: null } },
        { session },
      );
      // A merged table is unmerged with the bill, but likewise stays seated.
      await Table.updateMany(
        { mergedInto: order.table },
        { $set: { mergedInto: null } },
        { session },
      );
    }
  });

  // Denormalised counters — outside the transaction because a failure here
  // must not undo a completed payment.
  if (order.customer) {
    await Customer.recordVisit(order.customer).catch((err) =>
      logger.warn('Failed to update customer visit counters', { message: err.message }),
    );
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

  return sendSuccess(res, {
    order: publicOrder(order),
    // The share link, returned once. The client keeps it for the WhatsApp
    // hand-off; the server cannot rebuild it after this response.
    invoice: {
      invoiceNo: order.invoiceNo,
      url: buildInvoiceUrl(order.invoiceNo, invoiceToken),
      /**
       * The customer's real number, so the till can hand the receipt over.
       *
       * The suggestion endpoint masks phone numbers on purpose — it is a
       * prefix search and an unmasked one would let anyone walk the customer
       * list. That protection is about SEARCH RESULTS. Here the bill is
       * already settled, the caller holds `pos:create_order`, and they need
       * the number to send the receipt they just took payment for. Withholding
       * it would mean a returning customer can never be sent their own bill.
       */
      customerPhone: customerPhone ?? null,
    },
  });
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
// DELETE /api/orders/:id
// ---------------------------------------------------------------------------
/**
 * Permanently remove an order. Admin only.
 *
 * ── Read this before changing it ───────────────────────────────────────────
 * This is the most destructive operation in the system, and unlike the menu
 * purge there is no safe subset it can be restricted to: every order has
 * already affected a report, a shift total, or a customer's history. Deleting
 * a paid order means the day's takings no longer reconcile against the cash in
 * the drawer, and nothing in the data will explain the gap.
 *
 * It exists because an operator asked for it. What follows is the set of
 * guardrails that make it defensible rather than reckless:
 *
 *   1. `order:delete` is admin-only and is deliberately NOT the same
 *      permission as voiding. A cashier who could delete their own orders
 *      could take cash and leave nothing behind to notice.
 *   2. A written reason of at least ten characters is required. "test" does
 *      not survive the validator.
 *   3. The audit entry carries a FULL snapshot — order number, every line,
 *      totals, tender, who rang it up. Once the row is gone that entry is the
 *      only record the sale ever existed, so it has to be self-contained.
 *   4. It is logged at warn level so it shows up in log-based alerting rather
 *      than only in a table nobody reads.
 *
 * Voiding remains the correct operation for ordinary mistakes.
 */
export const deleteOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  // Built before anything is destroyed, and deliberately complete: a partial
  // snapshot is worse than none, because it looks like a record.
  const snapshot = {
    orderNo: order.orderNo,
    type: order.type,
    status: order.status,
    table: order.table ? String(order.table) : null,
    customer: order.customer ? String(order.customer) : null,
    items: order.items.map((line) => ({
      name: line.nameSnapshot,
      qty: line.qty,
      unitPriceMinor: line.priceMinorAtSale,
      note: line.note,
    })),
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt,
    createdBy: String(order.createdBy),
    createdAt: order.createdAt,
  };

  await withTransaction(async (session) => {
    // The ticket references the order, so it has to go in the same breath.
    // Left behind it would be a board entry whose populate() resolves to null
    // — which renders as a blank card the kitchen cannot clear.
    await Ticket.deleteMany({ order: order._id }, { session });

    // Free the table only if it still points at THIS order. An unconditional
    // clear would release a table that has since been seated by someone else.
    if (order.table) {
      await Table.updateOne(
        { _id: order.table, currentOrder: order._id },
        { $set: { currentOrder: null, status: TABLE_STATUS.AVAILABLE, occupiedAt: null } },
        { session },
      );
    }

    await Order.deleteOne({ _id: order._id }, { session });
  });

  emitEvent(EVENTS.ORDER_VOIDED, { orderId: String(order._id), orderNo: order.orderNo });

  // Written after the commit: an audit line for a delete that rolled back
  // would be a false record of a sale being destroyed.
  await AuditLog.record(
    {
      action: AUDIT_ACTION.ORDER_DELETE,
      resource: 'Order',
      resourceId: order._id,
      meta: { reason, ...snapshot },
    },
    req,
  );

  logger.warn('Order permanently deleted', {
    orderNo: snapshot.orderNo,
    totalMinor: snapshot.totalMinor,
    status: snapshot.status,
    by: req.user.id,
    reason,
  });

  return sendSuccess(res, { deleted: true, id: String(order._id), orderNo: snapshot.orderNo });
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
  deleteOrder,
};
