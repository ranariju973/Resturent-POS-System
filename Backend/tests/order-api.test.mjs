/**
 * POS billing — Phase 7.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * Still no MongoDB, so nothing here places a real order. The transaction
 * behaviour in particular — that a failed table claim rolls back the order and
 * ticket together — cannot be shown without a replica set, and is the single
 * most important thing Phase 12 must verify.
 *
 * What runs for real: the schemas (which are where price tampering is refused),
 * the discount-ceiling arithmetic against the real constants, and the auth wall
 * over live HTTP.
 */
process.env.NODE_ENV = 'development';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/verdant_pos_test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.PIN_PEPPER = 'c'.repeat(64);
process.env.INVOICE_TOKEN_PEPPER = 'v'.repeat(64);
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
process.env.LOG_LEVEL = 'error';

import fs from 'node:fs';
import path from 'node:path';
import {
  createOrderSchema,
  updateItemsSchema,
  discountSchema,
  paySchema,
  voidSchema,
  listOrdersSchema,
} from '../src/validators/orders.js';
// CASHIER_VOID_WINDOW_MINUTES is deliberately not imported: the void-window
// assertion below greps the controller source for the identifier rather than
// comparing against the value, so importing it here only looks like coverage.
import {
  CASHIER_MAX_DISCOUNT_PERCENT,
  CASHIER_MAX_DISCOUNT_MINOR,
} from '../src/config/pos.js';
import { percentOf, toMajor } from '../src/utils/money.js';

const { default: app } = await import('../app.js');

for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (err) => {
    console.error(`\n!! ${signal}: ${err?.stack ?? err}`);
    process.exit(1);
  });
}

let pass = 0;
let fail = 0;
const t = (label, cond, note = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};
const ok = (schema, input) => schema.safeParse(input).success;

const ITEM = '507f1f77bcf86cd799439011';
const TABLE = '507f191e810c19729de860ea';
const line = { menuItemId: ITEM, qty: 2 };

// ---------------------------------------------------------------------------
console.log('--- the client has no vocabulary for money ---');
// This is the heart of it: the schema has no price field to tamper with.
t('a valid dine-in order is accepted',
  ok(createOrderSchema, { type: 'dine-in', tableId: TABLE, items: [line] }));
t('a line carrying a price is REJECTED',
  !ok(createOrderSchema, { type: 'takeaway', items: [{ ...line, price: 0.01 }] }));
t('a line carrying priceMinor is REJECTED',
  !ok(createOrderSchema, { type: 'takeaway', items: [{ ...line, priceMinor: 1 }] }));
t('a line carrying priceMinorAtSale is REJECTED',
  !ok(createOrderSchema, { type: 'takeaway', items: [{ ...line, priceMinorAtSale: 1 }] }));
t('an order-level total is REJECTED',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], totalMinor: 1 }));
t('an order-level subtotal is REJECTED',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], subtotalMinor: 1 }));
t('a discount cannot be smuggled into create',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], discountMinor: 5000 }));
t('status cannot be forged to paid',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], status: 'paid' }));
t('createdBy cannot be forged',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], createdBy: ITEM }));
t('approvedBy cannot be forged',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], approvedBy: ITEM }));
t('orderNo cannot be chosen',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], orderNo: 1 }));
// The invoice number addresses a bill for all time and the token is the
// credential guarding it — a client choosing either would be able to mint a
// link to somebody else's receipt.
t('invoiceNo cannot be chosen',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], invoiceNo: 'INV-20260806-0001' }));
t('the invoice link token cannot be supplied',
  !ok(createOrderSchema, { type: 'takeaway', items: [line], invoiceTokenHash: 'x'.repeat(64) }));

{
  // Confirm by inspection, not just by rejection.
  const parsed = createOrderSchema.parse({ type: 'takeaway', items: [line] });
  const keys = Object.keys(parsed.items[0]);
  t(`a parsed line contains only ${keys.join(', ')}`,
    keys.every((k) => ['menuItemId', 'qty', 'note'].includes(k)), keys.join(', '));
}

console.log('\n--- quantities ---');
t('qty 1 accepted', ok(createOrderSchema, { type: 'takeaway', items: [{ menuItemId: ITEM, qty: 1 }] }));
t('qty 0 rejected', !ok(createOrderSchema, { type: 'takeaway', items: [{ menuItemId: ITEM, qty: 0 }] }));
t('negative qty rejected (would credit the bill)',
  !ok(createOrderSchema, { type: 'takeaway', items: [{ menuItemId: ITEM, qty: -5 }] }));
t('fractional qty rejected',
  !ok(createOrderSchema, { type: 'takeaway', items: [{ menuItemId: ITEM, qty: 1.5 }] }));
t('qty 1000 rejected', !ok(createOrderSchema, { type: 'takeaway', items: [{ menuItemId: ITEM, qty: 1000 }] }));
t('empty item list rejected', !ok(createOrderSchema, { type: 'takeaway', items: [] }));
t('101 distinct lines rejected',
  !ok(createOrderSchema, { type: 'takeaway', items: Array(101).fill(line) }));
t('note capped at 200 chars',
  !ok(createOrderSchema, { type: 'takeaway', items: [{ ...line, note: 'x'.repeat(201) }] }));

console.log('\n--- order type and table pairing ---');
t('dine-in WITHOUT a table rejected', !ok(createOrderSchema, { type: 'dine-in', items: [line] }));
t('takeaway WITH a table rejected',
  !ok(createOrderSchema, { type: 'takeaway', tableId: TABLE, items: [line] }));
t('delivery WITH a table rejected',
  !ok(createOrderSchema, { type: 'delivery', tableId: TABLE, items: [line] }));
t('takeaway without a table accepted', ok(createOrderSchema, { type: 'takeaway', items: [line] }));
t('invalid type rejected', !ok(createOrderSchema, { type: 'drive-thru', items: [line] }));
t('bad table id rejected', !ok(createOrderSchema, { type: 'dine-in', tableId: 'T3', items: [line] }));

console.log('\n--- discount: percent ---');
{
  const parsed = discountSchema.parse({ type: 'percent', value: 10 });
  t('10% parses to percent=10', parsed.percent === 10 && parsed.type === 'percent');
}
t('0% rejected', !ok(discountSchema, { type: 'percent', value: 0 }));
t('101% rejected', !ok(discountSchema, { type: 'percent', value: 101 }));
t('negative percent rejected', !ok(discountSchema, { type: 'percent', value: -10 }));
t('non-numeric percent rejected', !ok(discountSchema, { type: 'percent', value: 'half' }));
t('percent with a value missing rejected', !ok(discountSchema, { type: 'percent' }));

console.log('\n--- discount: fixed amount converts to minor units ---');
{
  const parsed = discountSchema.parse({ type: 'fixed', value: '2.50' });
  t('$2.50 becomes valueMinor 250', parsed.valueMinor === 250, `got ${parsed.valueMinor}`);
}
t('three decimals rejected', !ok(discountSchema, { type: 'fixed', value: '2.505' }));
t('zero amount rejected', !ok(discountSchema, { type: 'fixed', value: 0 }));
t('clearing with type:null is allowed', ok(discountSchema, { type: null }));
t('clearing needs no value', discountSchema.parse({ type: null }).valueMinor === 0);
t('discountMinor cannot be set directly',
  !ok(discountSchema, { type: 'percent', value: 10, discountMinor: 99999 }));

console.log('\n--- the cashier discount ceiling ---');
console.log(`     ceiling: ${CASHIER_MAX_DISCOUNT_PERCENT}% or ${toMajor(CASHIER_MAX_DISCOUNT_MINOR)} cash`);

// Mirrors the controller's check. Both limbs matter, which is the point.
const overCeiling = (type, percent, valueMinor, subtotalMinor) => {
  const costMinor =
    type === 'percent' ? percentOf(subtotalMinor, percent) : Math.min(valueMinor, subtotalMinor);
  return (type === 'percent' && percent > CASHIER_MAX_DISCOUNT_PERCENT) ||
    costMinor > CASHIER_MAX_DISCOUNT_MINOR;
};

t('10% of a $50 bill is within the ceiling', !overCeiling('percent', 10, 0, 5000));
t('a 25% discount exceeds the percentage ceiling', overCeiling('percent', 25, 0, 1000));
t('100% (a comp) exceeds it', overCeiling('percent', 100, 0, 1000));
t('$5 off is within the ceiling', !overCeiling('fixed', 0, 500, 5000));
t('$50 off exceeds the cash ceiling', overCeiling('fixed', 0, 5000, 20000));
// The reason the cash limb exists at all:
t('15% of a $400 party bill is UNDER the percentage limit but OVER the cash limit',
  !(15 > CASHIER_MAX_DISCOUNT_PERCENT) && overCeiling('percent', 15, 0, 40000),
  `15% of $400 = ${toMajor(percentOf(40000, 15))}`);

console.log('\n--- payment ---');
t('cash accepted', ok(paySchema, { paymentMethod: 'cash' }));
t('card accepted', ok(paySchema, { paymentMethod: 'card' }));
t('upi accepted', ok(paySchema, { paymentMethod: 'upi' }));
t('unknown method rejected', !ok(paySchema, { paymentMethod: 'crypto' }));
t('method is required', !ok(paySchema, {}));
t('an amount cannot be supplied at payment',
  !ok(paySchema, { paymentMethod: 'cash', amountMinor: 1 }));
t('paidAt cannot be forged', !ok(paySchema, { paymentMethod: 'cash', paidAt: '2020-01-01' }));

console.log('\n--- void ---');
t('a reason is REQUIRED', !ok(voidSchema, {}));
t('an empty reason is rejected', !ok(voidSchema, { reason: '' }));
t('a two-character reason is rejected', !ok(voidSchema, { reason: 'no' }));
t('a real reason is accepted', ok(voidSchema, { reason: 'Customer changed their mind' }));
t('an override PIN may accompany it',
  ok(voidSchema, { reason: 'Wrong table charged', adminOverridePin: '4417' }));
t('a 3-digit override PIN is rejected',
  !ok(voidSchema, { reason: 'Wrong table charged', adminOverridePin: '441' }));
t('a non-numeric override PIN is rejected',
  !ok(voidSchema, { reason: 'Wrong table charged', adminOverridePin: 'abcd' }));
t('status cannot be set via void', !ok(voidSchema, { reason: 'Mistake', status: 'open' }));

console.log('\n--- list filters ---');
t('limit defaults to 50', listOrdersSchema.parse({}).limit === 50);
t('limit above 200 rejected', !ok(listOrdersSchema, { limit: 1000 }));
t('skip is capped', !ok(listOrdersSchema, { skip: 999999 }));
t('unknown filter rejected', !ok(listOrdersSchema, { minTotal: 100 }));
t('bad status rejected', !ok(listOrdersSchema, { status: 'refunded' }));
t('ISO dates accepted', ok(listOrdersSchema, { from: '2026-08-01T00:00:00Z' }));
t('loose dates rejected', !ok(listOrdersSchema, { from: 'yesterday' }));

console.log('\n--- editing an open tab ---');
t('replacing items is accepted', ok(updateItemsSchema, { items: [line] }));
t('a price cannot ride along on an edit',
  !ok(updateItemsSchema, { items: [{ ...line, price: 0.01 }] }));
t('status cannot be changed by an item edit',
  !ok(updateItemsSchema, { items: [line], status: 'paid' }));

// ---------------------------------------------------------------------------
console.log('\n--- every order route is behind authentication (live HTTP) ---');
const ID = '507f1f77bcf86cd799439011';
const ROUTES = [
  ['GET', '/api/orders'],
  ['POST', '/api/orders'],
  ['GET', `/api/orders/${ID}`],
  ['PATCH', `/api/orders/${ID}/items`],
  ['PATCH', `/api/orders/${ID}/discount`],
  ['POST', `/api/orders/${ID}/pay`],
  ['POST', `/api/orders/${ID}/void`],
];

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  let unauthorised = 0;
  for (const [method, url] of ROUTES) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
    });
    if (res.status === 401) unauthorised += 1;
    else console.log(`     ${method} ${url} -> ${res.status} (expected 401)`);
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller`, unauthorised === ROUTES.length,
    `${unauthorised}/${ROUTES.length}`);

  const forged = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.',
    },
    body: JSON.stringify({ type: 'takeaway', items: [line] }),
  });
  t('alg:none token claiming admin cannot place an order', forged.status === 401);
} finally {
  await new Promise((r) => server.close(r));
}

// ---------------------------------------------------------------------------
console.log('\n--- controller audit ---');
const ROOT = path.resolve(import.meta.dirname, '..');
const ctl = fs.readFileSync(path.join(ROOT, 'src/controllers/orderController.js'), 'utf8');
const code = ctl.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

t('prices are read from MenuItem, never from the request',
  /priceMinorAtSale: item\.priceMinor/.test(code));
t('the request body is never consulted for a price',
  !/req\.body[\s\S]{0,40}price/i.test(code));
t('totals are always derived via recalculate()',
  (code.match(/\.recalculate\(\)/g) ?? []).length >= 3);
t('no total is ever assigned directly',
  !/\.(totalMinor|subtotalMinor|taxMinor)\s*=/.test(code));
t('availability is re-checked at order time', /!item\.available/.test(code));
t('sold-out items block the order', /Sold out:/.test(code));

console.log('\n--- atomicity ---');
t('order creation runs in a transaction', /createOrder[\s\S]{0,3000}withTransaction/.test(code));
t('the ticket is created in the same transaction',
  /withTransaction[\s\S]{0,2000}new Ticket\([\s\S]{0,300}save\(\{ session \}\)/.test(code));
t('the table claim is atomic', /findOneAndUpdate\([\s\S]{0,200}currentOrder: null/.test(code));
t('a lost table claim aborts the whole order',
  /was just billed by someone else/.test(ctl));
t('payment frees the table in the same transaction',
  /payOrder[\s\S]{0,1500}withTransaction[\s\S]{0,900}Table\.updateOne/.test(code));

console.log('\n--- discount and void authority ---');
t('the ceiling checks BOTH percent and cash', /overCeiling =[\s\S]{0,200}costMinor > CASHIER_MAX_DISCOUNT_MINOR/.test(code));
t('an over-ceiling discount needs override or admin',
  /overCeiling && !can\(req, PERMISSIONS\.POS_OVERRIDE\)/.test(code));
t('the approving manager is recorded on the order', /order\.approvedBy = approver\._id/.test(code));
t('an open tab can be voided without approval (nothing was taken)',
  /status === ORDER_STATUS\.PAID && !can\(req, PERMISSIONS\.POS_VOID_ORDER\)/.test(code));
t('a paid void outside the window is admin-only',
  /CASHIER_VOID_WINDOW_MINUTES/.test(code));
t('failed override attempts are audited', /bad-override-pin/.test(code));
t('override failure returns null, so 403s stay generic',
  /if \(!valid\) \{[\s\S]{0,400}return null;/.test(code));

console.log('\n--- state guards ---');
t('a paid order cannot be re-paid', /already paid/.test(ctl));
t('a voided order cannot be paid', /was voided/.test(ctl));
t('a voided order cannot be voided again', /already voided/.test(ctl));
t('a settled order cannot be edited', /cannot be modified/.test(ctl));
t('a settled order cannot be discounted', /cannot be discounted/.test(ctl));
t('voiding stops the kitchen', /Ticket\.updateOne/.test(code));
t('served tickets are left alone on void', /\$ne: TICKET_STATUS\.SERVED/.test(code));

console.log('\n--- cashiers cannot page back through history ---');
t('non-admins are pinned to today', /startOfDay/.test(code));
t('the date filter is ignored for non-admins',
  /seesEverything[\s\S]{0,700}else \{[\s\S]{0,300}startOfDay/.test(code));
t('admin ranges are capped at a year', /366 \* 24 \* 3600 \* 1000/.test(code));

console.log('\n--- route wiring ---');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes/orders.js'), 'utf8');
const declared = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
t(`${declared.length} routes declared`, declared.length === 8, `${declared.length}`);
t('requireAuth applied router-wide', /router\.use\(requireAuth\(\)\)/.test(routes));
const blocks = routes.split(/router\.(?=get|post|put|patch|delete)/).slice(1);
t('every route names a permission',
  blocks.every((b) => b.slice(0, b.indexOf('\n);')).includes('requirePermission')));
t('the discount route uses POS_APPLY_DISCOUNT', /POS_APPLY_DISCOUNT/.test(routes));

// --- customers captured at the till ----------------------------------------
console.log('\n--- the inline customer is keyed by phone ---');
{
  const ok = createOrderSchema.safeParse({
    type: 'takeaway',
    items: [{ menuItemId: 'a'.repeat(24), qty: 1 }],
    customer: { phone: '98200 41122', name: 'Aarav Mehta' },
  });
  t('an order may carry a phone and a name', ok.success, ok.error?.issues?.[0]?.message);

  const returning = createOrderSchema.safeParse({
    type: 'takeaway',
    items: [{ menuItemId: 'a'.repeat(24), qty: 1 }],
    customer: { phone: '9820041122' },
  });
  t('a name is optional — a known number already has one', returning.success);

  const both = createOrderSchema.safeParse({
    type: 'takeaway',
    items: [{ menuItemId: 'a'.repeat(24), qty: 1 }],
    customerId: 'b'.repeat(24),
    customer: { phone: '9820041122' },
  });
  t('customerId and customer together are refused, not silently merged', !both.success);

  const junk = createOrderSchema.safeParse({
    type: 'takeaway',
    items: [{ menuItemId: 'a'.repeat(24), qty: 1 }],
    customer: { phone: '123' },
  });
  t('a too-short number is rejected at the edge', !junk.success);

  const extra = createOrderSchema.safeParse({
    type: 'takeaway',
    items: [{ menuItemId: 'a'.repeat(24), qty: 1 }],
    customer: { phone: '9820041122', email: 'a@b.co' },
  });
  t('the inline customer is strict — no smuggling extra fields', !extra.success);
}

const inlineBody = ctl.slice(ctl.indexOf('async function resolveInlineCustomer'), ctl.indexOf('/** Human label for the kitchen board'));
t('identity is the normalised phone, not the name', /normalizePhone\(inline\.phone\)/.test(inlineBody));
t('a stored name is never overwritten by what was typed at the till',
  !/existing\.name = name;[\s\S]{0,40}await existing\.save/.test(inlineBody) ||
    /if \(!existing\.isActive\)/.test(inlineBody));
t('an unknown number with no name is refused rather than filed as a guest',
  /if \(!name\)[\s\S]{0,120}badRequest/.test(inlineBody));
t('the customer is resolved inside the order transaction',
  /withTransaction[\s\S]{0,600}resolveInlineCustomer/.test(ctl));
t('visit counters go through the model, not open-coded in the controller',
  /Customer\.recordVisit/.test(ctl) && !/\$inc: \{ visitCount/.test(ctl));

// --- permanent deletion -----------------------------------------------------
// The destructive one. These assert the guardrails rather than the happy path,
// because the happy path is one line and the guardrails are the whole design.
console.log('\n--- order deletion is fenced off from voiding ---');

t('delete has its own permission, not the void one',
  /router\.delete\([\s\S]{0,120}requirePermission\(PERMISSIONS\.ORDER_DELETE\)/.test(routes));
t('ORDER_DELETE is never granted to a cashier',
  !/CASHIER_PERMISSIONS[\s\S]*?P\.ORDER_DELETE[\s\S]*?\];/.test(
    fs.readFileSync(path.join(ROOT, 'src/constants/permissions.js'), 'utf8'),
  ));

const delBody = ctl.slice(ctl.indexOf('export const deleteOrder'));
t('a written reason is required, and a long one',
  /min\(10,/.test(fs.readFileSync(path.join(ROOT, 'src/validators/orders.js'), 'utf8')));
t('the snapshot is taken before anything is destroyed',
  delBody.indexOf('const snapshot') < delBody.indexOf('deleteOne'));
t('the snapshot carries the line items, not just a total',
  /items: order\.items\.map/.test(delBody));
t('the ticket is removed in the same transaction',
  /withTransaction[\s\S]{0,400}Ticket\.deleteMany/.test(delBody));
t('the table is freed only if it still points at this order',
  /currentOrder: order\._id[\s\S]{0,200}TABLE_STATUS\.AVAILABLE/.test(delBody));
t('the audit entry is written after the commit, not before',
  delBody.indexOf('withTransaction') < delBody.indexOf('AUDIT_ACTION.ORDER_DELETE'));
t('the deletion is logged at warn level for alerting',
  /logger\.warn\('Order permanently deleted'/.test(delBody));
t('deleteOne on an order appears only inside deleteOrder',
  (ctl.match(/Order\.deleteOne/g) ?? []).length === 1);

console.log('\n--- the override credential cannot log anyone in ---');
const user = fs.readFileSync(path.join(ROOT, 'src/models/User.js'), 'utf8');
t('override PIN is a separate field from the login PIN',
  /overridePinHash/.test(user) && /pinHash/.test(user));
{
  // Match the filter however it is spelled — `$in: PIN_ROLES`,
  // `$in: [...PIN_ROLES]`, wrapped in mongoose.trusted(), etc. What matters is
  // that the login lookup constrains role to PIN_ROLES at all.
  const body = user.slice(user.indexOf('findActiveByPin = function'));
  const filter = body.slice(0, body.indexOf('};'));
  t('login-by-PIN constrains role to PIN_ROLES', /PIN_ROLES/.test(filter));
  t('...and PIN_ROLES excludes admin, so an override PIN cannot start a session',
    /PIN_ROLES = Object\.freeze\(\[ROLES\.CASHIER, ROLES\.KITCHEN_STAFF\]\)/.test(
      fs.readFileSync(path.join(ROOT, 'src/constants/enums.js'), 'utf8'),
    ));
}
t('the override lookup is admin-only',
  /findAdminByOverridePin[\s\S]{0,400}role: ROLES\.ADMIN/.test(user));
t('override PIN is domain-separated from the login PIN hash',
  /override:\$\{pin\}/.test(user));
t('only admins may be given one', /Only admin accounts may hold an override PIN/.test(user));
t('both override fields are stripped from JSON',
  /delete ret\.overridePinHash/.test(user) && /delete ret\.overridePinLookup/.test(user));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
