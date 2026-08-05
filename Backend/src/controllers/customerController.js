/**
 * Customer records.
 *
 * ── Order history is queried, never embedded ───────────────────────────────
 * A customer document holds no array of past orders. History comes from the
 * Order collection by reference, paginated. The Phase 1 note explains why: an
 * unbounded embedded array grows until a regular's document hits MongoDB's
 * 16MB ceiling and can no longer be saved at all — a failure that arrives
 * years in, on your best customer, with no obvious cause.
 *
 * ── Search is the ReDoS surface ────────────────────────────────────────────
 * A search box that interpolates user text into a RegExp is the classic way to
 * hang an event loop: `(a+)+$` compiled unescaped will do it. The model's
 * `search()` escapes every metacharacter first, so the worst a caller can do
 * is search for a literal string containing brackets.
 */
import mongoose from 'mongoose';
import { Customer, normalizePhone, escapeRegex } from '../models/Customer.js';
import { Order } from '../models/Order.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, ORDER_STATUS } from '../constants/enums.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { can } from '../middleware/rbac.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { toMajor } from '../utils/money.js';
import { logger } from '../utils/logger.js';
import { assertCustomerUnreferenced } from '../utils/referenceGuard.js';

const publicCustomer = (customer, stats) => ({
  id: String(customer._id),
  name: customer.name,
  phone: customer.phone,
  email: customer.email ?? '',
  notes: customer.notes ?? '',
  lastVisitAt: customer.lastVisitAt,
  visitCount: customer.visitCount ?? 0,
  createdAt: customer.createdAt,
  ...(stats ?? {}),
});

// ---------------------------------------------------------------------------
// GET /api/customers/lookup
// ---------------------------------------------------------------------------
/**
 * Resolve a phone number to a customer, for the billing screen's auto-fill.
 *
 * ── This endpoint is a reverse phone directory if built carelessly ─────────
 * It answers "who owns this number" to anyone holding a POS login. Four things
 * keep that from being a way to harvest the customer list, and all four are
 * load-bearing:
 *
 *   1. EXACT match on the full normalised number. Deliberately NOT
 *      `Customer.search()`, which prefix-matches phones — a prefix search here
 *      would let a caller walk the list one digit at a time.
 *   2. The narrowest useful response: found, id, name. No email, no notes, no
 *      visit history. The billing screen needs a name to show and an id to
 *      attach to the order; anything more is a leak with no caller.
 *   3. A per-user rate limit on the route (see `lookupLimiter`).
 *   4. The same answer shape whether or not there was a match, so "no such
 *      customer" is not distinguishable by anything except the flag itself.
 *
 * If a future change makes this return more fields, revisit all four.
 */
export const lookupByPhone = asyncHandler(async (req, res) => {
  const digits = normalizePhone(req.query.phone);

  // The validator already enforces a minimum, but this is the guard that would
  // matter if the schema were ever loosened: an empty or near-empty query must
  // never turn into a match-everything lookup.
  if (digits.length < 6) return sendSuccess(res, { found: false });

  const customer = await Customer.findOne({ phoneNormalized: digits, isActive: true }).select(
    'name',
  );

  if (!customer) return sendSuccess(res, { found: false });

  return sendSuccess(res, { found: true, id: String(customer._id), name: customer.name });
});

// ---------------------------------------------------------------------------
// GET /api/customers/suggest
// ---------------------------------------------------------------------------
/**
 * Type-ahead for the billing screen's phone box.
 *
 * ── This one is a prefix search, and that is a real trade ──────────────────
 * `lookupByPhone` matches the whole number and cannot be walked. This matches
 * a prefix from four digits, which can be — type 9820, read the names, try
 * 9821. It exists because a cashier holding a phone number they half-remember
 * is a genuine counter workflow, and the alternative they would otherwise use
 * (the full customer list, already reachable at `GET /api/customers?search=`)
 * leaks strictly more.
 *
 * So this is the narrower path, not a new hole:
 *
 *   • at most 5 results, so a prefix returns a sample rather than a page
 *   • the middle of each number is masked — enough to tell two candidates
 *     apart at the till, not enough to copy one down
 *   • no email, notes, spend or visit history
 *   • the same per-user rate limiter as the exact lookup
 *
 * If a wider result set or an unmasked number is ever wanted here, that is a
 * decision about exposing the customer list, not a UI tweak.
 */
export const suggestByPhone = asyncHandler(async (req, res) => {
  const digits = normalizePhone(req.query.phone);
  if (digits.length < 4) return sendSuccess(res, { suggestions: [] });

  const matches = await Customer.find({
    // trusted() because `sanitizeFilter` is on globally (src/config/db.js).
    // `digits` is \d+ by construction — normalizePhone strips everything else
    // — so there is nothing here for a regex metacharacter to hide in.
    phoneNormalized: mongoose.trusted({ $regex: `^${digits}` }),
    isActive: true,
  })
    .select('name phone')
    .sort({ lastVisitAt: -1 })
    .limit(5);

  return sendSuccess(res, {
    suggestions: matches.map((c) => ({
      id: String(c._id),
      name: c.name,
      phoneMasked: maskPhone(c.phone, digits.length),
    })),
  });
});

/**
 * Show what the caller already typed, plus the last two digits, and mask the
 * rest: '98200•••22'. The caller supplied the prefix, so revealing it back
 * tells them nothing new; the tail is what lets them tell two candidates apart.
 */
function maskPhone(phone, prefixLength) {
  const digits = normalizePhone(phone);
  const head = digits.slice(0, Math.min(prefixLength, digits.length));
  const tail = digits.slice(-2);
  const hidden = Math.max(0, digits.length - head.length - tail.length);
  return `${head}${'•'.repeat(hidden)}${hidden > 0 ? tail : ''}`;
}

// ---------------------------------------------------------------------------
// GET /api/customers
// ---------------------------------------------------------------------------
/**
 * List or search customers.
 *
 * Always bounded. Without a limit this endpoint is a one-request export of
 * every phone number the restaurant holds, available to any signed-in cashier
 * — which is a very different thing from looking up the regular standing at
 * the counter.
 */
export const listCustomers = asyncHandler(async (req, res) => {
  const { search, limit, skip, sort } = req.query;

  const filter = { isActive: true };

  if (search) {
    const safe = escapeRegex(search);
    const digits = normalizePhone(search);

    // Anchored to the start: a prefix search is what staff actually do, and it
    // can use the index. An unanchored /term/ scans every document.
    // trusted() because `sanitizeFilter` is on globally (src/config/db.js);
    // the term is already escaped above.
    const conditions = [{ name: mongoose.trusted({ $regex: `^${safe}`, $options: 'i' }) }];
    if (digits) conditions.push({ phoneNormalized: mongoose.trusted({ $regex: `^${digits}` }) });
    filter.$or = conditions;
  }

  const sortBy =
    sort === 'name' ? { name: 1 } : sort === 'visits' ? { visitCount: -1 } : { lastVisitAt: -1 };

  const [customers, total] = await Promise.all([
    Customer.find(filter).sort(sortBy).skip(skip).limit(limit),
    Customer.countDocuments(filter),
  ]);

  /**
   * Lifetime spend and order count for everyone on this page.
   *
   * ONE grouped aggregation over the page's ids, not a query per row: a list of
   * fifty customers must not become fifty round trips, and the $in is served by
   * the { customer: 1 } index on Order.
   *
   * Deliberately the same field names the detail endpoint returns
   * (`lifetimeSpendMinor` / `lifetimeSpend` / `paidOrderCount`), so the list and
   * the detail view stay one shape and the client needs one mapper rather than
   * two that can drift.
   *
   * Only PAID orders count. An open tab is not money the customer has spent.
   */
  const ids = customers.map((c) => c._id);
  const spendByCustomer = new Map();

  if (ids.length > 0) {
    // trusted() because `sanitizeFilter` is on globally (src/config/db.js).
    const rows = await Order.aggregate([
      { $match: { customer: mongoose.trusted({ $in: ids }), status: ORDER_STATUS.PAID } },
      { $group: { _id: '$customer', spentMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
    ]);
    for (const row of rows) spendByCustomer.set(String(row._id), row);
  }

  return sendSuccess(res, {
    customers: customers.map((c) => {
      const spend = spendByCustomer.get(String(c._id));
      return publicCustomer(c, {
        lifetimeSpendMinor: spend?.spentMinor ?? 0,
        lifetimeSpend: toMajor(spend?.spentMinor ?? 0),
        paidOrderCount: spend?.orders ?? 0,
      });
    }),
    total,
    limit,
    skip,
    hasMore: skip + customers.length < total,
  });
});

// ---------------------------------------------------------------------------
// GET /api/customers/:id
// ---------------------------------------------------------------------------
export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({ _id: req.params.id, isActive: true });
  if (!customer) throw ApiError.notFound('Customer not found');

  // Lifetime spend, computed rather than stored — a denormalised total would
  // drift the first time an order is voided after the fact.
  const [totals] = await Order.aggregate([
    { $match: { customer: customer._id, status: ORDER_STATUS.PAID } },
    { $group: { _id: null, spentMinor: { $sum: '$totalMinor' }, orders: { $sum: 1 } } },
  ]);

  return sendSuccess(res, {
    customer: publicCustomer(customer, {
      lifetimeSpendMinor: totals?.spentMinor ?? 0,
      lifetimeSpend: toMajor(totals?.spentMinor ?? 0),
      paidOrderCount: totals?.orders ?? 0,
    }),
  });
});

// ---------------------------------------------------------------------------
// GET /api/customers/:id/history
// ---------------------------------------------------------------------------
/**
 * Past orders for one customer.
 *
 * ── Why a cashier may see this, when they cannot see Reports ───────────────
 * These are two different things. Reports expose aggregate revenue, margins
 * and expenses — the owner's commercial position. This is one person's order
 * history, which is exactly what "the usual?" requires. A cashier who cannot
 * see it cannot do the job the screen exists for.
 *
 * Paginated regardless: a regular of three years has hundreds of orders, and
 * returning all of them to render a list of twenty is wasteful at best.
 */
export const getCustomerHistory = asyncHandler(async (req, res) => {
  const { limit, skip } = req.query;

  const customer = await Customer.findOne({ _id: req.params.id, isActive: true }).select('_id');
  if (!customer) throw ApiError.notFound('Customer not found');

  const filter = { customer: customer._id };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('orderNo type status totalMinor items createdAt paidAt'),
    Order.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    orders: orders.map((order) => ({
      id: String(order._id),
      orderNo: order.orderNo,
      type: order.type,
      status: order.status,
      totalMinor: order.totalMinor,
      total: toMajor(order.totalMinor),
      itemCount: order.items.reduce((sum, line) => sum + line.qty, 0),
      items: order.items.map((line) => ({ name: line.nameSnapshot, qty: line.qty })),
      createdAt: order.createdAt,
      paidAt: order.paidAt,
    })),
    total,
    limit,
    skip,
    hasMore: skip + orders.length < total,
  });
});

// ---------------------------------------------------------------------------
// POST /api/customers
// ---------------------------------------------------------------------------
/**
 * Create a customer.
 *
 * A duplicate phone returns 409 WITH the existing customer's id. That is not a
 * PII leak: the caller already holds `customer:view` and could find the same
 * record by searching that number. Withholding the id would only mean the
 * cashier retypes the search by hand.
 */
export const createCustomer = asyncHandler(async (req, res) => {
  const digits = normalizePhone(req.body.phone);

  const existing = await Customer.findOne({ phoneNormalized: digits }).select('_id isActive');
  if (existing) {
    if (existing.isActive) {
      throw ApiError.conflict('A customer with that phone number already exists', {
        code: 'DUPLICATE_PHONE',
        details: [{ field: 'phone', message: 'Already registered', existingId: String(existing._id) }],
      });
    }
    // The number belongs to an inactive record. Deletes are hard now, so this
    // is either a legacy soft-deleted row from before that change or one
    // scrubbed via `?erase=true`. Reviving the document keeps its order
    // history attached, rather than stranding it behind a second customer
    // with the same phone number.
    const revived = await Customer.findById(existing._id);
    Object.assign(revived, req.body, { isActive: true });
    await revived.save();

    await AuditLog.record(
      {
        action: AUDIT_ACTION.CUSTOMER_CREATE,
        resource: 'Customer',
        resourceId: revived._id,
        meta: { revived: true },
      },
      req,
    );

    return sendSuccess(res, { customer: publicCustomer(revived) }, { status: 201 });
  }

  const customer = await Customer.create(req.body);

  await AuditLog.record(
    {
      action: AUDIT_ACTION.CUSTOMER_CREATE,
      resource: 'Customer',
      resourceId: customer._id,
      // Deliberately no name/phone/email — the audit trail records that a
      // customer was created, not who they are.
      meta: {},
    },
    req,
  );

  return sendSuccess(res, { customer: publicCustomer(customer) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// PUT /api/customers/:id
// ---------------------------------------------------------------------------
export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({ _id: req.params.id, isActive: true });
  if (!customer) throw ApiError.notFound('Customer not found');

  if (req.body.phone) {
    const digits = normalizePhone(req.body.phone);
    const clash = await Customer.findOne({
      phoneNormalized: digits,
      _id: mongoose.trusted({ $ne: customer._id }),
      isActive: true,
    }).select('_id');

    if (clash) {
      throw ApiError.conflict('Another customer already has that phone number', {
        code: 'DUPLICATE_PHONE',
      });
    }
  }

  Object.assign(customer, req.body);
  await customer.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.CUSTOMER_UPDATE,
      resource: 'Customer',
      resourceId: customer._id,
      // Field NAMES only. The values are PII and have no business here.
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { customer: publicCustomer(customer) });
});

// ---------------------------------------------------------------------------
// DELETE /api/customers/:id
// ---------------------------------------------------------------------------
/**
 * Remove a customer. Two quite different operations behind one route.
 *
 * ── Default: hard delete, guarded ──────────────────────────────────────────
 * The row leaves MongoDB entirely — but only when no order references it. A
 * customer with history returns 409 instead, because deleting them would
 * strand those orders and put holes in every report that joins through the
 * customer. This is what "delete" means to a cashier who mistyped a number:
 * the mistake is genuinely gone.
 *
 * ── `?erase=true`: irreversible PII scrub (admin only) ─────────────────────
 * This restaurant stores names, phone numbers and email addresses. Under the
 * DPDP Act in India — and GDPR elsewhere — a person can ask for that to be
 * erased, and a soft delete does not satisfy the request: the data is still
 * there, just hidden.
 *
 * So erasure overwrites the identifying fields in place and keeps the document
 * as an anonymous shell, so historical orders still resolve to *something* and
 * the day's takings do not change. It cannot be undone, which is the point.
 */
export const deleteCustomer = asyncHandler(async (req, res) => {
  const erase = req.query.erase === 'true';

  const customer = await Customer.findById(req.params.id);
  if (!customer || (!customer.isActive && !erase)) throw ApiError.notFound('Customer not found');

  if (erase) {
    // Guarded separately from `customer:delete` — a cashier tidying up the
    // list should not be able to make an irreversible change.
    if (!can(req, PERMISSIONS.USER_MANAGE)) {
      throw ApiError.forbidden('Erasing customer data requires an administrator');
    }

    const anonymousPhone = `erased-${String(customer._id).slice(-8)}`;

    customer.name = 'Erased customer';
    customer.phone = anonymousPhone.slice(0, 24);
    customer.phoneNormalized = undefined; // frees the number for genuine reuse
    customer.email = '';
    customer.notes = '';
    customer.isActive = false;

    // The regex validator on `phone` would reject the placeholder, so this
    // write deliberately bypasses document validation. Every field being set
    // here is server-authored, so there is nothing to validate.
    await Customer.updateOne(
      { _id: customer._id },
      {
        $set: {
          name: customer.name,
          phone: customer.phone,
          email: '',
          notes: '',
          isActive: false,
        },
        $unset: { phoneNormalized: 1 },
      },
    );

    logger.info('Customer PII erased', { requestId: req.id, customerId: String(customer._id) });

    await AuditLog.record(
      {
        action: AUDIT_ACTION.CUSTOMER_DELETE,
        resource: 'Customer',
        resourceId: customer._id,
        meta: { erased: true, irreversible: true },
      },
      req,
    );

    return sendSuccess(res, { erased: true, id: String(customer._id) });
  }

  // Hard delete, guarded. A customer with order history cannot be removed —
  // those orders would be left pointing at nothing and every report that joins
  // through the customer would show gaps. The 409 points at `?erase=true`,
  // which is the correct tool for "this person must not be in our records":
  // it scrubs the PII while keeping the shell so the takings do not move.
  await assertCustomerUnreferenced(customer._id);

  await Customer.deleteOne({ _id: customer._id });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.CUSTOMER_DELETE,
      resource: 'Customer',
      resourceId: customer._id,
      // No name/phone/email: the audit trail records that a customer record
      // was destroyed, not who they were.
      meta: { erased: false, hardDeleted: true },
    },
    req,
  );

  return sendSuccess(res, { deleted: true, id: String(customer._id) });
});

export default {
  lookupByPhone,
  suggestByPhone,
  listCustomers,
  getCustomer,
  getCustomerHistory,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
