/**
 * The customer-facing invoice.
 *
 * ── The only unauthenticated data route in the app ─────────────────────────
 * Everything else behind `/api` requires a session and a permission. This does
 * not, by design: a customer receives a link in WhatsApp and opens it on a
 * phone that has never signed in. That makes this file the whole public
 * attack surface, and it is written accordingly.
 *
 * ── Why the serialiser lives here and not in orderController ───────────────
 * `publicOrder` there is misleadingly named — it is the STAFF shape, and it
 * carries `createdBy`, `approvedBy`, `voidReason` and internal ids. If the
 * public response were built from it, a future field added for the till would
 * be published to the internet by default. A separate function in a separate
 * file means widening the public surface has to be a deliberate edit to this
 * file.
 */
import { Order } from '../models/Order.js';
import { hashInvoiceToken } from '../models/Order.js';
import { ORDER_STATUS } from '../constants/enums.js';
import { Tenant } from '../models/Tenant.js';
import { runUnscoped, runInTenant } from '../utils/tenantContext.js';
import { parseInvoiceSlug } from '../utils/invoiceLink.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { toMajor } from '../utils/money.js';

/**
 * What a customer is allowed to see.
 *
 * Money is in MAJOR units only. The `*Minor` integers are how the server
 * stores value; a receipt needs the amount, and shipping both doubles the
 * surface for nothing.
 *
 * Deliberately absent, each for its own reason:
 *   • the order's ObjectId — a valid id for the authed /api/orders/:id route,
 *     which is free reconnaissance even though that route would refuse them
 *   • createdBy / voidedBy / approvedBy — which cashier rang up a bill is
 *     nobody's business but the restaurant's
 *   • voidReason — internal free text a manager typed, e.g. "suspected card
 *     fraud". Never shown to the person it is about.
 *   • menuItem ids
 *   • the customer's phone — they know their own number, and printing it means
 *     a forwarded screenshot leaks it to whoever it was forwarded to
 */
const publicInvoice = (order, tenant) => ({
  invoiceNo: order.invoiceNo,
  orderNo: order.orderNo,
  status: order.status,
  type: order.type,

  placedAt: order.createdAt,
  paidAt: order.paidAt,
  paymentMethod: order.paymentMethod,

  // Populated, so these are names rather than ids.
  tableName: order.table?.name ?? null,
  customerName: order.customer?.name ?? null,

  items: order.items.map((line) => ({
    name: line.nameSnapshot,
    qty: line.qty,
    note: line.note,
    unitPrice: toMajor(line.priceMinorAtSale),
    lineTotal: toMajor(line.priceMinorAtSale * line.qty),
  })),

  subtotal: toMajor(order.subtotalMinor),
  discount: toMajor(order.discountMinor),
  tax: toMajor(order.taxMinor),
  taxRate: order.taxRate,
  total: toMajor(order.totalMinor),

  /**
   * Who the customer bought from, read from the Tenant.
   *
   * `footerLine || tagline` because a restaurant that has written its own
   * footer means it to replace the default greeting, and the schema's
   * empty-string defaults are what make `||` correct — a cleared field falls
   * through to the next option rather than printing a blank line.
   */
  restaurant: {
    name: tenant?.name || '',
    tagline: tenant?.footerLine || tenant?.tagline || '',
    address: tenant?.address || '',
    phone: tenant?.phone || '',
    gstNumber: tenant?.gstNumber || '',
  },
});

// ---------------------------------------------------------------------------
// GET /api/invoice/:slug     (public — no session)
// ---------------------------------------------------------------------------
/**
 * Resolve an invoice link.
 *
 * ── Everything is one answer: 404 ──────────────────────────────────────────
 * A malformed slug, a wrong token, a mismatched pair, an order that was never
 * paid — all return the same "Invoice not found". Distinguishing them would
 * turn this endpoint into an oracle: "that number exists but your token is
 * wrong" tells an attacker their enumeration is working.
 */
export const getPublicInvoice = asyncHandler(async (req, res) => {
  const parsed = parseInvoiceSlug(req.params.slug);
  if (!parsed) throw ApiError.notFound('Invoice not found');

  /**
   * Looked up by the TOKEN, never by the invoice number.
   *
   * The number is guessable by design — it is sequential so a human can read
   * it. If it were the lookup key, incrementing the digits would walk every
   * bill the restaurant took that day. The token is the credential; the number
   * is then verified against what the token found, so a mismatched pair is
   * refused rather than serving whichever half matched.
   */
  /*
   * ── Resolving the restaurant from the token ──────────────────────────────
   * A customer opening a receipt has no session and no tenant, so this first
   * read is deliberately unscoped: the token is what identifies BOTH the order
   * and the restaurant it belongs to. That is safe because invoiceTokenHash is
   * 192 bits of CSPRNG output hashed with a server-side pepper — unguessable,
   * and the only globally-unique index left on Order.
   *
   * No `.populate()` here. Everything that follows runs inside the resolved
   * tenant, so every document this endpoint returns came out of a
   * tenant-filtered query rather than being reached by an unscoped join.
   */
  const found = await runUnscoped('public invoice token -> tenant resolution', async () =>
    Order.findOne({ invoiceTokenHash: hashInvoiceToken(parsed.token) })
      .select('+invoiceTokenHash +tenantId')
      .lean());

  if (!found) throw ApiError.notFound('Invoice not found');
  if (found.invoiceNo !== parsed.invoiceNo) throw ApiError.notFound('Invoice not found');

  /**
   * A token only exists once a bill is settled, so an open order cannot reach
   * here. The check is kept anyway: it costs nothing and it means a future
   * change that mints tokens earlier cannot silently publish unpaid bills.
   *
   * A VOIDED order still renders — the customer holding the link deserves to
   * see that the bill was cancelled rather than a dead page.
   */
  if (found.status === ORDER_STATUS.OPEN) throw ApiError.notFound('Invoice not found');

  /*
   * Re-read inside the restaurant the token resolved to. The second query
   * costs one indexed lookup on a rate-limited public route and buys the
   * guarantee above — that no populated table or customer name was fetched
   * across a tenant boundary.
   */
  return runInTenant(found.tenantId, async () => {
    const [order, tenant] = await Promise.all([
      Order.findById(found._id).populate('table', 'name').populate('customer', 'name'),
      // Tenant is not itself tenant-scoped, so it is addressed by id.
      Tenant.findById(found.tenantId).lean(),
    ]);

    // The order was there a moment ago; if it is not now, answer as always.
    if (!order) throw ApiError.notFound('Invoice not found');

    return sendSuccess(res, { invoice: publicInvoice(order, tenant) });
  });
});

export default { getPublicInvoice };
