/**
 * Static audit of the model sources — checks the guarantees that must hold
 * before Phase 2 builds auth on top of them.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT,'src/models',f),'utf8');
let pass=0,fail=0;
const t=(label,ok,note='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'} ${label}${note?`  ${note}`:''}`);};

console.log('--- credential fields never leave the server ---');
const u=read('User.js');
for(const f of ['passwordHash','pinHash','pinLookup','tokenVersion','failedLoginAttempts','lockUntil'])
  t(`User.toJSON deletes ${f}`, new RegExp(`delete ret\\.${f};`).test(u));
for(const f of ['passwordHash','pinHash','pinLookup'])
  t(`User.${f} is select:false`, new RegExp(`${f}:\\s*\\{[^}]*select:\\s*false`).test(u));
t('no hardcoded credential literal in User.js', !/(password|pin)\s*[:=]\s*['"][^'"]{3,}['"]/i.test(u.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'')));
t('bcrypt cost >= 12', /BCRYPT_COST\s*=\s*(1[2-9]|[2-9]\d)/.test(u));
t('PIN pepper comes from env, not source', /env\.PIN_PEPPER/.test(u) && !/PIN_PEPPER\s*=\s*['"]/.test(u));

console.log('\n--- every model strips mongo internals ---');
for(const f of ['User.js','Category.js','MenuItem.js','Table.js','Order.js','Ticket.js','Customer.js','Expense.js','AuditLog.js']){
  const s=read(f);
  t(`${f} deletes _id (exposes id virtual)`, /delete ret\._id;/.test(s));
}

console.log('\n--- PII / secrets not exposed ---');
t('MenuItem hides imagePublicId', /delete ret\.imagePublicId;/.test(read('MenuItem.js')));
t('Customer hides phoneNormalized', /delete ret\.phoneNormalized;/.test(read('Customer.js')));
t('Customer escapes regex before RegExp', /escapeRegex/.test(read('Customer.js')));

console.log('\n--- integrity constraints ---');
const o=read('Order.js');
t('Order snapshots price at sale', /priceMinorAtSale/.test(o));
t('Order snapshots item name', /nameSnapshot/.test(o));
t('Order has a pre-validate totals guard', /pre\('validate'[\s\S]{0,200}verifyTotals/.test(o));
t('Order: one open order per table (unique partial index)', /partialFilterExpression[\s\S]{0,120}OPEN/.test(o));
t('Table forbids client-chosen transitions', /canTransitionTo/.test(read('Table.js')));
t('Ticket.advance takes no target status', /advance = function advance\(userId/.test(read('Ticket.js')));
t('Ticket derives next from stored status', /NEXT_TICKET_STATUS\[this\.status\]/.test(read('Ticket.js')));
t('AuditLog blocks updates', /Audit log entries are immutable/.test(read('AuditLog.js')));
t('AuditLog redacts meta before save', /pre\('save', function scrubMeta/.test(read('AuditLog.js')));
t('Counter uses atomic $inc', /\$inc:\s*\{\s*seq:\s*1\s*\}/.test(read('Counter.js')));

console.log('\n--- money fields all use the minor-unit helper ---');
const moneyFields=[];
for(const f of ['MenuItem.js','Order.js','Expense.js']){
  const s=read(f);
  for(const m of s.matchAll(/(\w*[Mm]inor\w*):\s*minorField/g)) moneyFields.push(`${f}:${m[1]}`);
}
t(`${moneyFields.length} money fields declared via minorField()`, moneyFields.length>=6, moneyFields.join(', '));
t('no bare Number money field named price/total/amount', !/\b(price|total|subtotal|amount):\s*\{\s*type:\s*Number/.test(read('Order.js')+read('MenuItem.js')+read('Expense.js')));

console.log('\n--- indexes declared for the hot queries ---');
/*
 * Asserted against the COMPILED schema rather than the source text.
 *
 * These were regexes over the file, which broke the moment every index gained
 * a tenantId prefix — and would have broken again on any reformatting. What
 * the test actually means is "an index with this key shape exists", so ask the
 * schema. It also catches an index declared through the tenantScoped plugin,
 * which a source regex cannot see at all.
 */
const { default: mongoose } = await import('mongoose');
await import(`${ROOT}/src/models/index.js`);

/** Does `model` declare an index whose key is exactly these fields, in order? */
const hasIndex = (model, ...fields) =>
  mongoose.models[model].schema.indexes()
    .some(([key]) => JSON.stringify(Object.keys(key)) === JSON.stringify(fields));

/** ...and is it unique? */
const hasUniqueIndex = (model, ...fields) =>
  mongoose.models[model].schema.indexes()
    .some(([key, opts]) => opts?.unique
      && JSON.stringify(Object.keys(key)) === JSON.stringify(fields));

t('Order: tenant + status + createdAt', hasIndex('Order', 'tenantId', 'status', 'createdAt'));
// Reports and the dashboard match on paidAt, not createdAt. Without this the
// index above is a near-miss: right field, wrong sort key, in-memory date filter.
t('Order: tenant + status + paidAt (reports)', hasIndex('Order', 'tenantId', 'status', 'paidAt'));
t('Ticket: tenant + status + placedAt', hasIndex('Ticket', 'tenantId', 'status', 'placedAt'));
// The board's grace-period branch for recently-served tickets.
t('Ticket: tenant + status + updatedAt (board)',
  hasIndex('Ticket', 'tenantId', 'status', 'updatedAt'));
t('Customer: unique phone, per restaurant',
  hasUniqueIndex('Customer', 'tenantId', 'phoneNormalized'));
t('MenuItem: POS grid composite',
  hasIndex('MenuItem', 'tenantId', 'isActive', 'available', 'category'));

console.log('\n--- every credential is unique PER RESTAURANT, never globally ---');
/*
 * The staff-PIN bug in one assertion. A GLOBAL unique index on pinLookup meant
 * one restaurant claiming a PIN denied it to every other, and worse, let a
 * lookup match another restaurant's row.
 */
for (const field of ['email', 'pinLookup', 'overridePinLookup']) {
  t(`User.${field} is unique within a restaurant`, hasUniqueIndex('User', 'tenantId', field));
  t(`User.${field} is NOT globally unique`, !hasUniqueIndex('User', field));
}

t('Order.invoiceNo is unique per restaurant', hasUniqueIndex('Order', 'tenantId', 'invoiceNo'));
/*
 * The one deliberate exception. A customer opening a receipt link has no
 * session and no restaurant — the token in the URL is what resolves both, so
 * it cannot itself be scoped by the thing it resolves.
 */
t('Order.invoiceTokenHash stays globally unique (it resolves the restaurant)',
  hasUniqueIndex('Order', 'invoiceTokenHash'));

/*
 * A compound TTL index is rejected by MongoDB outright, so this one must stay
 * single-field or the index sync — and the boot — fails.
 */
const auditTtl = mongoose.models.AuditLog.schema.indexes()
  .find(([, opts]) => opts?.expireAfterSeconds !== undefined);
t('AuditLog retention TTL is still a single-field index',
  Boolean(auditTtl) && Object.keys(auditTtl[0]).length === 1 && auditTtl[0].at === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
