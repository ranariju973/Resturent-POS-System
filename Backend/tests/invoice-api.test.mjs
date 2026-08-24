/**
 * Public invoice links.
 *
 * ── Why this file is stricter than the others ──────────────────────────────
 * This is the only route in the app a stranger can reach without a session, so
 * it is the whole public attack surface. Two properties carry the entire
 * design and both are asserted here rather than assumed:
 *
 *   1. the link is unguessable, and only a HASH of it is ever stored
 *   2. the public response carries nothing about staff, ids, or phone numbers
 *
 * The slug helpers and the hash are pure, so those run for real. The rest is a
 * source audit plus the live route over HTTP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatInvoiceNo, mintInvoiceToken, hashInvoiceToken } from '../src/models/Order.js';
import {
  buildInvoiceSlug,
  parseInvoiceSlug,
  buildInvoiceUrl,
} from '../src/utils/invoiceLink.js';
import { invoiceSlugSchema } from '../src/validators/invoice.js';
import { nextSequenceWithDay } from '../src/models/Counter.js';

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

const ROOT = path.resolve(import.meta.dirname, '..');
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ctlSrc = read('src/controllers/invoiceController.js');
const ctl = strip(ctlSrc);
const orderCtl = strip(read('src/controllers/orderController.js'));
const model = strip(read('src/models/Order.js'));
const routeSrc = strip(read('src/routes/invoice.js'));

// ---------------------------------------------------------------------------
console.log('--- the invoice number ---');
t('is formatted from the counter day, not a fresh clock read',
  formatInvoiceNo('2026-08-06', 41) === 'INV-20260806-0041');
t('the ordinal is zero-padded to four', formatInvoiceNo('2026-12-31', 7) === 'INV-20261231-0007');
t('a busy day past 999 still formats', formatInvoiceNo('2026-08-06', 1234) === 'INV-20260806-1234');
// The whole reason nextSequenceWithDay exists: orderNo resets daily and is not
// unique, so the DATE has to come from the same read that picked the counter.
t('the counter returns the day it keyed on', /return \{ seq: doc\.seq \+ \(start - 1\), day \}/.test(strip(read('src/models/Counter.js'))));
t('and reads the clock exactly once', /const day = serviceDayKey\(\);/.test(strip(read('src/models/Counter.js'))));
t('the order controller composes the number from THAT day',
  /const \{ seq: orderNo, day \} = await nextSequenceWithDay/.test(orderCtl) &&
    /invoiceNo: formatInvoiceNo\(day, orderNo\)/.test(orderCtl));
t('nextSequenceWithDay is exported', typeof nextSequenceWithDay === 'function');

console.log('\n--- the token is unguessable, and never stored ---');
const token = mintInvoiceToken();
t('minted from crypto.randomBytes, not Math.random',
  /randomBytes\(24\)/.test(model) && !/Math\.random/.test(model));
t('192 bits, base64url', token.length === 32 && /^[A-Za-z0-9_-]+$/.test(token));
t('two mints never collide', mintInvoiceToken() !== mintInvoiceToken());
t('the hash is deterministic, so lookup is one indexed query',
  hashInvoiceToken(token) === hashInvoiceToken(token));
t('different tokens hash differently', hashInvoiceToken(token) !== hashInvoiceToken(mintInvoiceToken()));
t('SHA-256 hex out', /^[0-9a-f]{64}$/.test(hashInvoiceToken(token)));
t('peppered from env, not a bare digest', /env\.INVOICE_TOKEN_PEPPER/.test(model));
// The point of hashing: a stolen database must not yield working links.
t('only the HASH is a schema field — no raw token column',
  /invoiceTokenHash: \{/.test(model) && !/invoiceToken: \{/.test(model));
t('the hash is select:false, so no ordinary find() ships it',
  /invoiceTokenHash: \{ type: String, default: null, select: false \}/.test(model));
t('bcrypt is NOT used here — a salted hash cannot be looked up',
  !/bcrypt/.test(model));

console.log('\n--- slug round-trip ---');
const invoiceNo = 'INV-20260806-0041';
const slug = buildInvoiceSlug(invoiceNo, token);
t('slug joins number and token', slug === `${invoiceNo}-${token}`);
{
  const back = parseInvoiceSlug(slug);
  t('parses back exactly', back?.invoiceNo === invoiceNo && back?.token === token);
}
// base64url includes '-', so a naive split('-') would truncate the token.
{
  const hyphenated = `ab-cd_ef${'x'.repeat(16)}`;
  const back = parseInvoiceSlug(buildInvoiceSlug(invoiceNo, hyphenated));
  t('a token containing a hyphen survives', back?.token === hyphenated);
}
t('garbage is rejected, not guessed at', parseInvoiceSlug('nonsense') === null);
t('an invoice number alone is not a slug', parseInvoiceSlug(invoiceNo) === null);
t('null is handled', parseInvoiceSlug(null) === null);
t('the URL is built from the configured public origin',
  buildInvoiceUrl(invoiceNo, token).endsWith(`/invoice/${slug}`));

console.log('\n--- the params schema is the whole public input surface ---');
t('a well-formed slug is accepted', ok(invoiceSlugSchema, { slug }));
t('a bare invoice number is refused', !ok(invoiceSlugSchema, { slug: invoiceNo }));
t('a short token is refused', !ok(invoiceSlugSchema, { slug: `${invoiceNo}-abc` }));
t('path traversal is refused', !ok(invoiceSlugSchema, { slug: '../../etc/passwd' }));
t('a mongo operator is refused', !ok(invoiceSlugSchema, { slug: { $ne: null } }));
t('an over-long token is refused', !ok(invoiceSlugSchema, { slug: `${invoiceNo}-${'a'.repeat(200)}` }));
t('unknown params are refused (.strict)', !ok(invoiceSlugSchema, { slug, admin: 'true' }));

console.log('\n--- lookup is by token, never by the guessable number ---');
t('the query keys on the token hash',
  /Order\.findOne\(\{ invoiceTokenHash: hashInvoiceToken\(parsed\.token\) \}\)/.test(ctl));
// If the number were the key, incrementing it would walk the day's takings.
t('the invoice number is NOT a query key', !/findOne\(\{ invoiceNo/.test(ctl));
t('but it is verified against what the token found',
  /found\.invoiceNo !== parsed\.invoiceNo/.test(ctl));
t('every failure is the same 404, so the route is not an oracle',
  (ctl.match(/notFound\('Invoice not found'\)/g) ?? []).length >= 4);
t('an unpaid order is refused', /found\.status === ORDER_STATUS\.OPEN/.test(ctl));

console.log('\n--- the public shape leaks nothing about the business ---');
// publicOrder in orderController is the STAFF shape and carries all of these.
// A separate serialiser is the only thing keeping them off the internet.
for (const field of ['createdBy', 'approvedBy', 'voidedBy', 'voidReason', 'menuItem']) {
  t(`${field} is absent from the public serialiser`, !ctl.includes(field));
}
// Reading order.subtotalMinor is fine — that is the stored value. What must
// not happen is publishing a KEY named *Minor, which would ship the internal
// integer representation alongside the amount for no gain.
{
  const body = ctl.slice(ctl.indexOf('const publicInvoice'), ctl.indexOf('GET /api/invoice'));
  const publishedKeys = [...body.matchAll(/^\s{2,4}(\w+):/gm)].map((m) => m[1]);
  t('no published key is a *Minor field — major units only',
    publishedKeys.every((k) => !k.endsWith('Minor')),
    publishedKeys.filter((k) => k.endsWith('Minor')).join(', '));
  t('and the amounts go through toMajor', /toMajor\(order\.totalMinor\)/.test(body));
}
t('the order ObjectId is not published', !/id: String\(order\._id\)/.test(ctl));
/*
 * The CUSTOMER's phone must never be published — they know their own number,
 * and a forwarded screenshot would leak it to whoever received it.
 *
 * The restaurant's own number is a different thing entirely: it belongs on a
 * receipt, the way it does on every printed bill. So this asserts on the
 * source of the value rather than on the word "phone", which cannot tell the
 * two apart.
 */
t('the customer phone is not published',
  !/order\.customer\?\.phone/.test(ctl) && !/customerPhone/.test(ctl));
t("the restaurant's own phone may appear, and comes from settings",
  !/phone: order\./.test(ctl));
t('the customer NAME is, and comes from a populate',
  /customerName: order\.customer\?\.name/.test(ctl) && /populate\('customer', 'name'\)/.test(ctl));
t('it does not reuse the staff serialiser', !/publicOrder/.test(ctl));

console.log('\n--- the link is minted at payment, and returned once ---');
{
  const payBody = orderCtl.slice(orderCtl.indexOf('export const payOrder'));
  t('a token is minted when the bill settles', /mintInvoiceToken\(\)/.test(payBody));
  t('the hash is what gets saved', /order\.invoiceTokenHash = hashInvoiceToken\(invoiceToken\)/.test(payBody));
  t('inside the same transaction as the status change',
    payBody.indexOf('withTransaction') < payBody.indexOf('order.invoiceTokenHash'));
  t('the response carries the URL', /url: buildInvoiceUrl\(order\.invoiceNo, invoiceToken\)/.test(payBody));
}
// A bill voided before it was ever paid must not be shareable.
t('createOrder assigns no token', !/invoiceTokenHash/.test(orderCtl.slice(
  orderCtl.indexOf('export const createOrder'), orderCtl.indexOf('export const payOrder'))));

console.log('\n--- route wiring ---');
t('the router applies NO requireAuth — this is the public route',
  !/requireAuth/.test(routeSrc));
t('it validates its one path param', /validate\(\{ params: invoiceSlugSchema \}\)/.test(routeSrc));
t('it carries its own rate limiter', /invoiceLimiter/.test(routeSrc));
t('the limiter is keyed by IP, since there is no session',
  /invoiceLimiter[\s\S]{0,300}keyGenerator: \(req\) => ipKeyGenerator\(req\)/.test(
    strip(read('src/middleware/rateLimit.js')),
  ));
t('mounted under /api/invoice', /app\.use\('\/api\/invoice', invoiceRoutes\)/.test(strip(read('app.js'))));

console.log('\n--- live HTTP ---');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // No Authorization header at all — exactly what a customer's phone sends.
  const malformed = await fetch(`${base}/api/invoice/not-a-slug`);
  t('a malformed slug is refused without a session', malformed.status === 400 || malformed.status === 404,
    `got ${malformed.status}`);

  const wellFormed = await fetch(`${base}/api/invoice/${slug}`);
  t('a well-formed but unknown slug is NOT an auth error',
    wellFormed.status !== 401 && wellFormed.status !== 403, `got ${wellFormed.status}`);

  const body = await wellFormed.json().catch(() => ({}));
  t('and says nothing about why it failed',
    !JSON.stringify(body).toLowerCase().includes('token'));
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
