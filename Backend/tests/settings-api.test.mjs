/**
 * Printer settings.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB, so nothing is written for real. What runs: the schemas, and the
 * auth wall over live HTTP. The rest is a source audit of the two properties
 * the design rests on — that a second settings document is impossible, and
 * that a blank field falls back to the built-in constant rather than printing
 * an empty receipt header.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  printerSettingsQuerySchema,
  updatePrinterSettingsSchema,
} from '../src/validators/settings.js';
import { PERMISSIONS, hasPermission } from '../src/constants/permissions.js';
import { ROLES } from '../src/constants/enums.js';

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

const model = strip(read('src/models/PrinterSettings.js'));
const ctl = strip(read('src/controllers/settingsController.js'));
const routeSrc = strip(read('src/routes/settings.js'));

console.log('--- paper width is one of two real sizes ---');
t('80mm accepted', ok(updatePrinterSettingsSchema, { paperWidth: 80 }));
t('58mm accepted', ok(updatePrinterSettingsSchema, { paperWidth: 58 }));
t('a string from a <select> coerces', ok(updatePrinterSettingsSchema, { paperWidth: '58' }));
t('57mm refused — no such roll', !ok(updatePrinterSettingsSchema, { paperWidth: 57 }));
t('A4 refused', !ok(updatePrinterSettingsSchema, { paperWidth: 210 }));

console.log('\n--- copies are bounded ---');
// A typo'd 50 would empty a paper roll before anyone reached the printer.
t('1 accepted', ok(updatePrinterSettingsSchema, { billCopies: 1 }));
t('5 accepted', ok(updatePrinterSettingsSchema, { kotCopies: 5 }));
t('0 refused', !ok(updatePrinterSettingsSchema, { billCopies: 0 }));
t('99 refused', !ok(updatePrinterSettingsSchema, { billCopies: 99 }));
t('a fraction refused', !ok(updatePrinterSettingsSchema, { billCopies: 2.5 }));

console.log('\n--- the body is strict ---');
t('an unknown key is refused', !ok(updatePrinterSettingsSchema, { hacker: 1 }));
t('server-derived effectiveName cannot be set',
  !ok(updatePrinterSettingsSchema, { effectiveName: 'Fake' }));
t('an empty body is valid — nothing to change is not an error',
  ok(updatePrinterSettingsSchema, {}));
t('markup in a receipt field is refused',
  !ok(updatePrinterSettingsSchema, { businessName: '<script>x</script>' }));
t('an ordinary address is accepted',
  ok(updatePrinterSettingsSchema, { businessAddress: '12 MG Road, Andheri West' }));
t('an over-long name is refused',
  !ok(updatePrinterSettingsSchema, { businessName: 'x'.repeat(81) }));

console.log('\n--- the GET takes nothing ---');
t('no params accepted', ok(printerSettingsQuerySchema, {}));
// Declared rather than exempted, so a stray param is a 400 instead of ignored.
t('a stray query param is refused', !ok(printerSettingsQuerySchema, { debug: '1' }));

console.log('\n--- a second settings document per restaurant is impossible ---');
/*
 * This used to be guaranteed by a fixed `_id: 'printer'`, which made a second
 * document impossible for the WHOLE DEPLOYMENT — correct with one restaurant,
 * and "only the first restaurant may have settings" with many. The guarantee
 * now takes the form it should: one document per tenant, enforced by a unique
 * index on tenantId that the plugin declares.
 */
t('uniqueness is declared on the tenant, not a fixed id',
  /plugin\(tenantScoped, \{\s*unique: \[\{ fields: \{\} \}\]/.test(model));
t('the fixed-id constant is gone', !/PRINTER_SETTINGS_ID/.test(model));
t('the write is an upsert the plugin scopes to one restaurant',
  /findOneAndUpdate\(\s*\{\}/.test(ctl) && /upsert: true/.test(ctl));

console.log('\n--- an unconfigured restaurant still works ---');
t('load() returns defaults rather than null', /statics\.load/.test(model));
t('and it does not write on a read', !/\.save\(\)/.test(model));
t('the GET never 404s', !/notFound/.test(ctl));

console.log('\n--- receipt identity comes from the restaurant, not a constant ---');
/*
 * Identity — name, address, GST number, footer — moved to the Tenant document.
 * It used to live on this model with a hardcoded RESTAURANT constant behind
 * it, so two places described one fact and a single deployment could only ever
 * name one restaurant.
 */
const tenantModel = strip(read('src/models/Tenant.js'));
const invoiceCtl = strip(read('src/controllers/invoiceController.js'));

t('the hardcoded restaurant constant is gone from config',
  !/export const RESTAURANT/.test(strip(read('src/config/pos.js'))));
t('identity fields live on the Tenant',
  /gstNumber/.test(tenantModel) && /footerLine/.test(tenantModel) && /tagline/.test(tenantModel));
t('the printer model no longer stores identity',
  !/businessName/.test(model) && !/gstNumber/.test(model));
t('the settings controller reads identity from the Tenant',
  /Tenant\.findById/.test(ctl) && /businessName: tenant\?\.name/.test(ctl));
t('the public invoice resolves the same source',
  /name: tenant\?\.name/.test(invoiceCtl));
// The empty-string defaults are what make `||` correct on the tenant fields.
t('every identity string defaults to empty',
  (tenantModel.match(/default: ''/g) ?? []).length >= 4);

console.log('\n--- the cache cannot serve a stale receipt header ---');
t('reads are memoised', /loadCachedSettings/.test(model));
t('and a save drops the memo', /invalidateSettingsCache\(\)/.test(ctl));
/*
 * The memo used to be a module-scope `let cached` — one slot for the whole
 * process. With many restaurants that is a cross-tenant leak: the first
 * receipt rendered would populate it and every other restaurant would print
 * that one's configuration for the next minute. Going through the cache's
 * key() partitions the entry by the tenant in context.
 */
t('the memo is keyed per restaurant, not a module-scope variable',
  /key\('settings'/.test(model) && !/^let cached/m.test(model));

console.log('\n--- permission ---');
t('settings:manage exists', PERMISSIONS.SETTINGS_MANAGE === 'settings:manage');
t('admin holds it', hasPermission(ROLES.ADMIN, PERMISSIONS.SETTINGS_MANAGE));
t('a cashier does not', !hasPermission(ROLES.CASHIER, PERMISSIONS.SETTINGS_MANAGE));
t('kitchen staff do not', !hasPermission(ROLES.KITCHEN_STAFF, PERMISSIONS.SETTINGS_MANAGE));
// Reusing user:manage would have made "printers but not salaries" unsayable.
t('it is NOT an alias for user:manage',
  PERMISSIONS.SETTINGS_MANAGE !== PERMISSIONS.USER_MANAGE);

console.log('\n--- route wiring ---');
t('auth applied router-wide', /router\.use\(requireAuth\(\)\)/.test(routeSrc));
t('and the permission too',
  /router\.use\(requirePermission\(PERMISSIONS\.SETTINGS_MANAGE\)\)/.test(routeSrc));
t('the GET validates its query', /validate\(\{ query: printerSettingsQuerySchema \}\)/.test(routeSrc));
t('the PUT validates its body', /validate\(\{ body: updatePrinterSettingsSchema \}\)/.test(routeSrc));
t('no public route shares this file', !/EXEMPTION|public/i.test(routeSrc.replace(/\s+/g, ' ').slice(0, 400)));
t('the write is audited', /AUDIT_ACTION\.SETTINGS_UPDATE/.test(ctl));
t('field names only, no receipt text, in the audit meta', /fields: Object\.keys\(req\.body\)/.test(ctl));

console.log('\n--- auth wall (live HTTP) ---');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const get = await fetch(`${base}/api/settings/printer`);
  t('an anonymous read is refused', get.status === 401, `got ${get.status}`);

  const put = await fetch(`${base}/api/settings/printer`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paperWidth: 58 }),
  });
  t('an anonymous write is refused', put.status === 401, `got ${put.status}`);
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
