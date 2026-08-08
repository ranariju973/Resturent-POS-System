/**
 * Employees — staff accounts, roles and PINs.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB, so nothing is created or deleted for real. What DOES run: the
 * schemas, the PIN-lookup HMAC imported from the model, and the auth wall over
 * live HTTP. Everything else is a source audit of the three properties this
 * feature actually depends on — the PIN-collision catch, the self-protection
 * guards, and the reference guard before deletion — asserted to exist AND to
 * run in the right order, because a guard after the destructive call is not a
 * guard.
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
  createEmployeeSchema,
  updateEmployeeSchema,
  setPinSchema,
  setActiveSchema,
  listEmployeesSchema,
} from '../src/validators/employees.js';

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

const ctlSrc = read('src/controllers/employeeController.js');
const ctl = strip(ctlSrc);
const guard = strip(read('src/utils/referenceGuard.js'));
const userSrc = strip(read('src/models/User.js'));
const routeSrc = strip(read('src/routes/employees.js'));

const VALID = { name: 'Asha Menon', role: 'cashier', pin: '4821' };

console.log('--- create schema ---');
t('a minimal valid employee is accepted', ok(createEmployeeSchema, VALID));
t('salary and join date are optional', createEmployeeSchema.parse(VALID).monthlySalaryMinor === 0);
t('major salary is converted to minor at the boundary',
  createEmployeeSchema.parse({ ...VALID, monthlySalary: '31000' }).monthlySalaryMinor === 3100000);
t('a fractional salary keeps both paise',
  createEmployeeSchema.parse({ ...VALID, monthlySalary: '1840.50' }).monthlySalaryMinor === 184050);
t('kitchen_staff is a valid role', ok(createEmployeeSchema, { ...VALID, role: 'kitchen_staff' }));
t('admin is NOT creatable here — it needs an email and a password',
  !ok(createEmployeeSchema, { ...VALID, role: 'admin' }));
t('an unknown role is rejected', !ok(createEmployeeSchema, { ...VALID, role: 'manager' }));
t('unknown keys are rejected (.strict)', !ok(createEmployeeSchema, { ...VALID, isAdmin: true }));
t('a name must be given', !ok(createEmployeeSchema, { role: 'cashier', pin: '4821' }));

console.log('\n--- the PIN is exactly four digits ---');
t('4 digits is accepted', ok(setPinSchema, { pin: '4821' }));
t('3 digits is rejected', !ok(setPinSchema, { pin: '482' }));
t('5 digits is rejected', !ok(setPinSchema, { pin: '48210' }));
t('letters are rejected', !ok(setPinSchema, { pin: '48a1' }));
t('a leading zero survives — it is a string, not a number',
  setPinSchema.parse({ pin: '0042' }).pin === '0042');
t('a number is rejected, since 0042 as a number is 42', !ok(setPinSchema, { pin: 4821 }));
t('the create schema enforces the same rule', !ok(createEmployeeSchema, { ...VALID, pin: '482' }));

console.log('\n--- update schema ---');
t('an empty body is refused', !ok(updateEmployeeSchema, {}));
t('a single field is enough', ok(updateEmployeeSchema, { name: 'Asha M' }));
t('role reassignment is allowed', ok(updateEmployeeSchema, { role: 'kitchen_staff' }));
t('the PIN cannot ride along inside an edit', !ok(updateEmployeeSchema, { pin: '4821' }));
t('promotion to admin is refused', !ok(updateEmployeeSchema, { role: 'admin' }));
t('salary is converted here too',
  updateEmployeeSchema.parse({ monthlySalary: '250' }).monthlySalaryMinor === 25000);
t('an untouched salary is not defaulted to zero',
  updateEmployeeSchema.parse({ name: 'Asha M' }).monthlySalaryMinor === undefined);

console.log('\n--- list + active schemas ---');
t('limit defaults to 50', listEmployeesSchema.parse({}).limit === 50);
t('limit is capped', !ok(listEmployeesSchema, { limit: 500 }));
t('includeInactive is an explicit opt-in', ok(listEmployeesSchema, { includeInactive: 'true' }));
t('isActive must be a boolean, not a string', !ok(setActiveSchema, { isActive: 'false' }));

console.log('\n--- PIN collisions are handled, not hoped about ---');
t('the model offers a pre-check', /statics\.pinTaken/.test(userSrc));
t('the pre-check can exclude the holder, so a re-save is not a self-collision',
  /pinTaken = async function pinTaken\(pin, exceptId/.test(userSrc));
t('the controller pre-checks before creating', /User\.pinTaken\(pin\)/.test(ctl));
t('and excludes the holder when changing an existing PIN',
  /User\.pinTaken\(pin, employee\._id\)/.test(ctl));
// The pre-check is a courtesy; the unique index is the guarantee. Both are needed.
t('the duplicate-key error is caught', /err\?\.code === 11000/.test(ctl));
t('the catch is scoped to pinLookup, not any duplicate key', /'pinLookup' in \(err/.test(ctl));
t('it becomes a 409 about PINs, not about a column name',
  /PIN_TAKEN_MESSAGE/.test(ctl) && /already in use by another employee/.test(ctlSrc));
t('the internal field name never reaches the admin',
  !/A record with that/.test(ctl));
t('both write paths go through the guarded save',
  (ctl.match(/savePinnedUser\(/g) ?? []).length >= 3);
t('the PIN is never echoed back', /pinSet: true/.test(ctl) && !/pin: pin/.test(ctl));

console.log('\n--- an admin cannot lock everyone out ---');
t('self-harm is refused', /function assertNotSelf/.test(ctl));
t('it compares ids, never roles', /String\(targetId\) === String\(req\.user\.id\)/.test(ctl));
t('self-delete is blocked', /assertNotSelf\(req, employee\._id, 'delete'\)/.test(ctl));
t('self-deactivate is blocked', /assertNotSelf\(req, employee\._id, 'deactivate'\)/.test(ctl));
t('self-demotion is blocked',
  /assertNotSelf\(req, employee\._id, 'change the role of'\)/.test(ctl));
t('the last active admin is protected', /assertAnotherAdminRemains/.test(ctl));
// The role→permission map is the only place a role may mean something.
t('admin roles are derived from the permission map, not hardcoded',
  /hasPermission\(role, PERMISSIONS\.USER_MANAGE\)/.test(ctl));
t('no role string is compared anywhere in this controller',
  !/role\s*===\s*['"]admin['"]/.test(ctl));

console.log('\n--- deletion cannot orphan the trading record ---');
t('a reference guard exists', /assertEmployeeUnreferenced/.test(guard));
t('it checks the cashier who rang up an order', /Order\.exists\(\{ createdBy: userId \}\)/.test(guard));
t('it checks voids and approvals', /voidedBy: userId/.test(guard) && /approvedBy: userId/.test(guard));
t('it checks expenses', /Expense\.exists\(\{ createdBy: userId \}\)/.test(guard));
t('it checks kitchen tickets', /'statusHistory\.by': userId/.test(guard));
// AuditLog.actor is deliberately NOT checked: it would refuse everyone who has
// ever logged in, and AuditLog denormalises actorName for exactly this reason.
t('AuditLog is deliberately not a blocker', !/AuditLog\.exists/.test(guard));
t('the 409 points the admin at deactivation instead',
  /Deactivate them instead/.test(read('src/utils/referenceGuard.js')));
t('the guard runs BEFORE the row is deleted',
  ctl.indexOf('assertEmployeeUnreferenced') < ctl.indexOf('User.deleteOne'));
// Scoped to the handler body: assertNotSelf is DEFINED earlier in the file, so
// a whole-file indexOf would compare against the definition, not the call.
const deleteBody = ctl.slice(ctl.indexOf('export const deleteEmployee'));
t('the self-check runs before the guard, since it is cheaper and more certain',
  deleteBody.indexOf('assertNotSelf') < deleteBody.indexOf('assertEmployeeUnreferenced'));
t('the delete is audited with a snapshot, since the row will be gone',
  /meta: \{ \.\.\.snapshot, deleted: true \}/.test(ctl));

console.log('\n--- removing access actually removes access ---');
// requireAuth re-reads isActive every request, but a fired employee is the last
// place to rely on one control where two are available.
t('deactivation revokes outstanding tokens',
  ctl.slice(ctl.indexOf('setEmployeeActive')).includes('revokeTokens'));
t('a PIN change revokes them too',
  ctl.slice(ctl.indexOf('setEmployeePin'), ctl.indexOf('setEmployeeActive')).includes('revokeTokens'));
t('so does a role change', /roleChanging[\s\S]{0,400}revokeTokens/.test(ctl));
t('a role change is audited apart from the ordinary edit',
  /AUDIT_ACTION\.USER_ROLE_CHANGE/.test(ctl) && /AUDIT_ACTION\.USER_UPDATE/.test(ctl));
t('the reserved USER_CREATE action is finally emitted', /AUDIT_ACTION\.USER_CREATE/.test(ctl));

console.log('\n--- no raw user document escapes ---');
t('responses go through the shared shape', /publicEmployee/.test(ctl));
t('which is built on publicUser', /publicUser/.test(strip(read('src/utils/publicUser.js'))));
t('credentials are not in the employee shape',
  !/pinHash|passwordHash|pinLookup:/.test(strip(read('src/utils/publicUser.js'))));
t('hasPin is a boolean, never the PIN itself',
  /hasPin: Boolean\(user\.pinLookup\)/.test(read('src/utils/publicUser.js')));

console.log('\n--- route wiring ---');
const routes = [...routeSrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
t('7 routes declared', routes.length === 7, String(routes.length));
t('requireAuth applied router-wide', /router\.use\(requireAuth\(\)\)/.test(routeSrc));
t('user:manage applied router-wide',
  /router\.use\(requirePermission\(PERMISSIONS\.USER_MANAGE\)\)/.test(routeSrc));
t('every route validates its input',
  routeSrc.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1)
    .every((block) => /validate\(\{/.test(block)));
t('every parameterised route validates its params',
  routeSrc.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1)
    .filter((b) => b.includes(':id'))
    .every((b) => /params: idParamSchema/.test(b)));
t('the collection routes are declared before /:id',
  routeSrc.indexOf("'/'") < routeSrc.indexOf("'/:id'"));

console.log('\n--- auth wall (live HTTP) ---');
const ID = '507f1f77bcf86cd799439011';
const ROUTES = [
  ['GET', '/api/employees'],
  ['POST', '/api/employees'],
  ['GET', `/api/employees/${ID}`],
  ['PUT', `/api/employees/${ID}`],
  ['PATCH', `/api/employees/${ID}/pin`],
  ['PATCH', `/api/employees/${ID}/active`],
  ['DELETE', `/api/employees/${ID}`],
];

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  let denied = 0;
  for (const [method, route] of ROUTES) {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    });
    if (res.status === 401) denied += 1;
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller`, denied === ROUTES.length,
    `${denied}/${ROUTES.length}`);

  // The roster carries salaries. An unauthenticated caller must not learn even
  // whether a given employee id exists.
  const probe = await fetch(`${base}/api/employees/${ID}`);
  t('an anonymous probe cannot distinguish a real id from a missing one',
    probe.status === 401, `got ${probe.status}`);
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
