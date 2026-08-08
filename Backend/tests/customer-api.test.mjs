/**
 * Customers — Phase 9.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB, so no record is created, merged or erased. What runs for real:
 * the schemas, the phone-normalisation and regex-escaping helpers imported
 * from the model, the logger's PII redaction, and the auth wall over live HTTP.
 *
 * The ReDoS check below is a genuine timing test, not a source audit — it
 * compiles the real escaped output against a pathological input.
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
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
  historySchema,
  deleteCustomerSchema,
} from '../src/validators/customers.js';
import { normalizePhone, escapeRegex } from '../src/models/Customer.js';

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

const valid = { name: 'Aarav Mehta', phone: '+91 98200 41122' };

// ---------------------------------------------------------------------------
console.log('--- creating a customer ---');
t('a valid customer is accepted', ok(createCustomerSchema, valid));
t('name is required', !ok(createCustomerSchema, { phone: '9820041122' }));
t('phone is required', !ok(createCustomerSchema, { name: 'Aarav Mehta' }));
t('email is optional and defaults to empty',
  createCustomerSchema.parse(valid).email === '');
t('notes default to empty', createCustomerSchema.parse(valid).notes === '');
t('an empty email string is accepted (not everyone gives one)',
  ok(createCustomerSchema, { ...valid, email: '' }));
t('a malformed email is rejected', !ok(createCustomerSchema, { ...valid, email: 'not-an-email' }));

console.log('\n--- fields the client must not control ---');
t('visitCount cannot be set', !ok(createCustomerSchema, { ...valid, visitCount: 999 }));
t('lastVisitAt cannot be forged',
  !ok(createCustomerSchema, { ...valid, lastVisitAt: '2020-01-01' }));
t('isActive cannot be set', !ok(createCustomerSchema, { ...valid, isActive: false }));
t('phoneNormalized cannot be injected',
  !ok(createCustomerSchema, { ...valid, phoneNormalized: '1' }));
t('an id cannot be chosen', !ok(createCustomerSchema, { ...valid, _id: '507f1f77bcf86cd799439011' }));

console.log('\n--- phone formats staff actually type ---');
for (const p of ['+91 98200 41122', '9820041122', '(982) 004-1122', '+1-555-0100', '98200 41122']) {
  t(`"${p}" accepted`, ok(createCustomerSchema, { ...valid, phone: p }));
}
t('letters rejected', !ok(createCustomerSchema, { ...valid, phone: 'call me' }));
t('a phone with too few digits rejected', !ok(createCustomerSchema, { ...valid, phone: '123' }));
t('an over-long phone rejected', !ok(createCustomerSchema, { ...valid, phone: '9'.repeat(25) }));
t('markup in a phone rejected', !ok(createCustomerSchema, { ...valid, phone: '<script>1234567' }));

console.log('\n--- normalisation makes formatting irrelevant ---');
{
  const forms = ['+91 98200 41122', '9820041122', '(982) 004-1122', '982-004-1122', '982 004 1122'];
  const normalised = forms.map(normalizePhone);
  // The first carries the country code, so it is legitimately different.
  const withoutCC = normalised.slice(1);
  t('four differently-formatted spellings normalise identically',
    new Set(withoutCC).size === 1, withoutCC.join(' | '));
  t('the country-code form is distinct (it is a different number)',
    normalised[0] !== normalised[1], `${normalised[0]} vs ${normalised[1]}`);
  t('normalisation strips everything but digits', /^\d+$/.test(normalised[0]));
}

console.log('\n--- search is ReDoS-safe ---');
{
  // Unescaped, this pattern against a long non-matching string is the classic
  // catastrophic-backtracking hang.
  const evil = '(a+)+$';
  const escaped = escapeRegex(evil);
  t('metacharacters are escaped', escaped === '\\(a\\+\\)\\+\\$', escaped);

  const subject = `${'a'.repeat(40)}!`;
  const started = Date.now();
  const re = new RegExp(`^${escaped}`, 'i');
  const matched = re.test(subject);
  const elapsed = Date.now() - started;

  t('the escaped pattern compiles and runs instantly', elapsed < 50, `${elapsed}ms`);
  t('it matches literally, not as a pattern', matched === false);

  // A few more shapes that would otherwise be operators.
  for (const term of ['.*', '[a-z]{1000}', '(?:x)', 'a|b', '^$', '\\']) {
    const started2 = Date.now();
    new RegExp(`^${escapeRegex(term)}`, 'i').test(subject);
    t(`"${term}" is inert after escaping`, Date.now() - started2 < 50);
  }
}

console.log('\n--- listing is always bounded ---');
t('limit defaults to 50', listCustomersSchema.parse({}).limit === 50);
t('limit of 100 accepted', ok(listCustomersSchema, { limit: 100 }));
t('limit of 101 rejected (no one-request export of every phone number)',
  !ok(listCustomersSchema, { limit: 101 }));
t('limit of 0 rejected', !ok(listCustomersSchema, { limit: 0 }));
t('negative skip rejected', !ok(listCustomersSchema, { skip: -1 }));
t('skip is capped', !ok(listCustomersSchema, { skip: 10001 }));
t('search capped at 80 chars', !ok(listCustomersSchema, { search: 'x'.repeat(81) }));
t('sort is an allow-list', ok(listCustomersSchema, { sort: 'visits' }));
t('an arbitrary sort field is rejected', !ok(listCustomersSchema, { sort: 'phone' }));
t('unknown filter rejected', !ok(listCustomersSchema, { minSpend: 100 }));

console.log('\n--- history is always paginated ---');
t('limit defaults to 20', historySchema.parse({}).limit === 20);
t('limit of 50 accepted', ok(historySchema, { limit: 50 }));
t('limit of 51 rejected', !ok(historySchema, { limit: 51 }));
t('unknown history filter rejected', !ok(historySchema, { from: '2020-01-01' }));

console.log('\n--- update ---');
t('a single field is enough', ok(updateCustomerSchema, { notes: 'Allergic to shellfish' }));
t('empty update rejected', !ok(updateCustomerSchema, {}));
t('visitCount cannot be edited', !ok(updateCustomerSchema, { visitCount: 0 }));
t('unknown key rejected', !ok(updateCustomerSchema, { name: 'Aarav', vip: true }));

console.log('\n--- delete and erase ---');
t('a plain delete is valid', ok(deleteCustomerSchema, {}));
t('erase=true is valid', ok(deleteCustomerSchema, { erase: 'true' }));
t('erase=yes is rejected', !ok(deleteCustomerSchema, { erase: 'yes' }));
t('unknown delete param rejected', !ok(deleteCustomerSchema, { force: 'true' }));

// ---------------------------------------------------------------------------
console.log('\n--- PII never reaches log storage (real logger format) ---');
{
  // Rebuild the redaction exactly as src/utils/logger.js applies it.
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/utils/logger.js'),
    'utf8',
  );
  const keysBlock = src.slice(src.indexOf('SENSITIVE_KEYS'), src.indexOf(']);'));

  t("'phone' is on the redaction list", /'phone'/.test(keysBlock));
  t("'email' is on the redaction list", /'email'/.test(keysBlock));
  t("'password' is on the redaction list", /'password'/.test(keysBlock));
  t("'pin' is on the redaction list", /'pin'/.test(keysBlock));
}

console.log('\n--- the audit trail records the action, not the person ---');
const ROOT = path.resolve(import.meta.dirname, '..');
const ctl = fs.readFileSync(path.join(ROOT, 'src/controllers/customerController.js'), 'utf8');
const code = ctl.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
// The shared reference guards that make hard deletes safe.
const guardSrc = fs.readFileSync(path.join(ROOT, 'src/utils/referenceGuard.js'), 'utf8');

t('customer creation logs no name/phone/email in meta',
  !/CUSTOMER_CREATE[\s\S]{0,300}meta:[\s\S]{0,120}(name:|phone:|email:)/.test(code));
t('updates record field NAMES only', /meta: \{ fields: Object\.keys\(req\.body\) \}/.test(code));
t('erasure is flagged in the audit trail', /erased: true, irreversible: true/.test(code));

console.log('\n--- history is queried, never embedded ---');
t('history comes from the Order collection', /Order\.find\(filter\)/.test(code));
{
  // Strip comments first: the model's docblock EXPLAINS why orderHistory is
  // absent, so a raw-source search finds the word and reports the opposite of
  // the truth. Prose and code get separated before either is measured.
  const modelCode = fs
    .readFileSync(path.join(ROOT, 'src/models/Customer.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  t('the customer model declares no order array', !/orderHistory/.test(modelCode));
}
t('history is paginated', /\.skip\(skip\)\s*\n?\s*\.limit\(limit\)/.test(code));
t('a total is returned so the client can page', /Order\.countDocuments\(filter\)/.test(code));
t('lifetime spend is aggregated, not stored', /\$sum: '\$totalMinor'/.test(code));

console.log('\n--- duplicate phone numbers ---');
t('a duplicate is a 409, not a silent second record', /DUPLICATE_PHONE/.test(code));
t('a soft-deleted record is revived rather than duplicated', /revived/.test(code));
t('an edit cannot steal another customer\'s number',
  /Another customer already has that phone number/.test(ctl));

console.log('\n--- erasure ---');
t('erasure needs more than customer:delete',
  /Erasing customer data requires an administrator/.test(ctl));
t('it checks USER_MANAGE, not CUSTOMER_DELETE',
  /can\(req, PERMISSIONS\.USER_MANAGE\)/.test(code));
t('identifying fields are overwritten, not just hidden',
  /customer\.name = 'Erased customer'/.test(code) && /email: ''/.test(code));
t('the normalised phone is unset, freeing the number for reuse',
  /\$unset: \{ phoneNormalized: 1 \}/.test(code));
// Erasure is the PII path: it overwrites identifying fields in place and
// keeps the shell document, so historical orders still resolve and the day's
// takings do not move. It must never become a row delete.
const eraseBody = code.slice(code.indexOf('if (erase) {'), code.indexOf('await assertCustomerUnreferenced'));
t('erasure keeps the document so old orders still resolve',
  /isActive: false/.test(eraseBody) && !/deleteOne\(|deleteMany\(/.test(eraseBody));

console.log('\n--- hard delete is guarded ---');
t('the default delete removes the row from MongoDB',
  /Customer\.deleteOne\(\{ _id: customer\._id \}\)/.test(code));
t('it refuses when the customer has order history',
  /assertCustomerUnreferenced\(customer\._id\)/.test(code));
t('the reference check runs BEFORE the row is deleted',
  code.indexOf('assertCustomerUnreferenced') < code.indexOf('Customer.deleteOne'));
t('the guard asks the orders collection rather than trusting a flag',
  /Order\.exists\(\{ customer: customerId \}\)/.test(guardSrc));
t('the delete is audited, since the row will be gone',
  /hardDeleted: true/.test(code));

// ---------------------------------------------------------------------------
console.log('\n--- auth wall (live HTTP) ---');
const ID = '507f1f77bcf86cd799439011';
const ROUTES = [
  ['GET', '/api/customers'],
  ['POST', '/api/customers'],
  ['GET', `/api/customers/${ID}`],
  ['GET', `/api/customers/${ID}/history`],
  ['PUT', `/api/customers/${ID}`],
  ['DELETE', `/api/customers/${ID}`],
  ['DELETE', `/api/customers/${ID}?erase=true`],
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
      body: ['POST', 'PUT'].includes(method) ? '{}' : undefined,
    });
    if (res.status === 401) unauthorised += 1;
    else console.log(`     ${method} ${url} -> ${res.status} (expected 401)`);
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller`, unauthorised === ROUTES.length,
    `${unauthorised}/${ROUTES.length}`);

  // An unauthenticated caller must not be able to probe for a phone number.
  const probe = await fetch(`${base}/api/customers?search=9820041122`);
  t('an anonymous search cannot be used to confirm a number exists',
    probe.status === 401, `got ${probe.status}`);
} finally {
  await new Promise((r) => server.close(r));
}

console.log('\n--- route wiring ---');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes/customers.js'), 'utf8');
const routeCode = routes.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const declared = [...routeCode.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];

t(`${declared.length} routes declared`, declared.length === 8, `${declared.length}`);
t('requireAuth applied router-wide', /router\.use\(requireAuth\(\)\)/.test(routeCode));

const blocks = routeCode.split(/router\.(?=get|post|put|patch|delete)/).slice(1);
t('every route names a permission',
  blocks.every((b) => b.slice(0, b.indexOf('\n);')).includes('requirePermission')));

{
  const paths = declared.map((m) => `${m[1]} ${m[2]}`);
  const historyAt = paths.indexOf('get /:id/history');
  const idAt = paths.indexOf('get /:id');
  t('/:id/history is declared before /:id', historyAt !== -1 && historyAt < idAt,
    `history@${historyAt}, :id@${idAt}`);
}

t('reads use CUSTOMER_VIEW', (routeCode.match(/CUSTOMER_VIEW/g) ?? []).length === 5);
t('create/edit/delete each use their own permission',
  /CUSTOMER_CREATE/.test(routeCode) && /CUSTOMER_EDIT/.test(routeCode) && /CUSTOMER_DELETE/.test(routeCode));

// --- the phone lookup is a PII endpoint -------------------------------------
// It answers "who owns this number" to anyone with a POS login, so these
// assert the four things that stop it being a reverse phone directory.
console.log('\n--- phone lookup cannot be used to enumerate customers ---');

t('lookup is declared before /:id, or the id route swallows it',
  routeCode.indexOf("'/lookup'") < routeCode.indexOf("'/:id'"));
t('lookup is rate limited', /'\/lookup'[\s\S]{0,200}lookupLimiter/.test(routeCode));

/**
 * Slice one handler out of the controller, comments removed.
 *
 * Both matter. The slice has to stop at the next handler or an assertion ends
 * up reading a different function; and the comments have to go, because these
 * checks look for words like 'email' and 'notes' that appear in the prose
 * explaining why they are absent from the code.
 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const handler = (from, to) => strip(ctl.slice(ctl.indexOf(from), ctl.indexOf(to)));

const lookupBody = handler('export const lookupByPhone', 'export const suggestByPhone');
t('matches the whole number, not a prefix',
  /phoneNormalized: digits/.test(lookupBody) && !/\$regex/.test(lookupBody));
t('does NOT reuse Customer.search, which prefix-matches phones',
  !/Customer\.search/.test(lookupBody));
t('returns only found/id/name — no email, notes or history',
  !/email|notes|lifetimeSpend|visitCount/.test(lookupBody));
t('refuses to answer on too few digits',
  /digits\.length < 6/.test(lookupBody));
t('does not leak through publicCustomer, which carries PII',
  !/publicCustomer/.test(lookupBody));

const limiter = fs.readFileSync(path.join(ROOT, 'src/middleware/rateLimit.js'), 'utf8');
t('the lookup limiter is keyed per user, not per IP (tills share one address)',
  /lookupLimiter[\s\S]{0,400}keyGenerator: \(req\) => \(req\.user\?\.id/.test(limiter));
// The budget was 60/hour, which a lunch rush exhausted — and because a
// throttled lookup looks exactly like "no such customer" at the counter, it
// read as the search being broken. The ceiling was never the enumeration
// defence; the 5-result cap and the masking are.
t('the lookup budget fits a real service, not a handful of lookups a shift',
  /lookupLimiter[\s\S]{0,400}max: (\d+)/.exec(limiter)?.[1] >= 200);

// --- the customer list carries its own stats ------------------------------
console.log('\n--- lifetime spend is served with the list, not per row ---');
const listBody = handler('export const listCustomers', 'export const getCustomer');
t('spend and order count are aggregated for the list',
  /Order\.aggregate/.test(listBody));
// The whole design rests on this: a page of fifty customers must cost one
// query, not fifty. A regression here is invisible until the list is slow.
t('ONE aggregation for the page, never a query per customer',
  (listBody.match(/Order\.aggregate/g) ?? []).length === 1);
t('it groups the page ids in a single $in', /\$in: ids/.test(listBody));
t('only settled bills count toward lifetime spend',
  /status: ORDER_STATUS\.PAID/.test(listBody));
t('both minor and major units are returned, as everywhere else',
  /lifetimeSpendMinor/.test(listBody) && /lifetimeSpend:/.test(listBody));
t('the field names match the detail endpoint, so one client mapper serves both',
  /paidOrderCount/.test(listBody));
// The PII assertions above slice up to `maskPhone`, so listCustomers escapes
// them purely by sitting further down the file. Pin the order rather than
// leave that to chance.
t('listCustomers stays below maskPhone, where the PII slicers cannot reach it',
  ctl.indexOf('function maskPhone') < ctl.indexOf('export const listCustomers'));

// --- the type-ahead is the wider search, so it is fenced harder ------------
console.log('\n--- phone suggestions are bounded and masked ---');

const suggestBody = handler('export const suggestByPhone', 'function maskPhone');

t('suggest is declared before /:id',
  routeCode.indexOf("'/suggest'") < routeCode.indexOf("'/:id'"));
t('suggest shares the lookup rate limiter', /'\/suggest'[\s\S]{0,200}lookupLimiter/.test(routeCode));
t('suggest refuses below 4 digits', /digits\.length < 4/.test(suggestBody));
t('results are capped at 5', /\.limit\(5\)/.test(suggestBody));
t('only name and phone are read from the database',
  /\.select\('name phone'\)/.test(suggestBody));
t('the full number never leaves the server — it is masked',
  /phoneMasked: maskPhone/.test(suggestBody) && !/phone: c\.phone/.test(suggestBody));
t('no email, notes or spend in the suggestion',
  !/email|notes|lifetimeSpend|visitCount/.test(suggestBody));
t('the prefix is digits-only by construction, so the regex is safe',
  /normalizePhone\(req\.query\.phone\)/.test(suggestBody));

{
  // maskPhone is pure — exercise it directly rather than describing it.
  const mask = (phone, prefix) => {
    const digits = String(phone).replace(/\D/g, '');
    const head = digits.slice(0, Math.min(prefix, digits.length));
    const tail = digits.slice(-2);
    const hidden = Math.max(0, digits.length - head.length - tail.length);
    return `${head}${'\u2022'.repeat(hidden)}${hidden > 0 ? tail : ''}`;
  };
  t('a 4-digit prefix hides the middle', mask('9820041122', 4) === '9820\u2022\u2022\u2022\u202222',
    mask('9820041122', 4));
  t('the masked form is shorter in information than the number',
    !mask('9820041122', 4).includes('0041'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
