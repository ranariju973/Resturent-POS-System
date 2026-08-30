/**
 * Terminal linking — the picker, and the re-link that makes it recoverable.
 *
 * ── The bug this suite pins down ───────────────────────────────────────────
 * The device cookie belongs to the BROWSER, not the account, and deliberately
 * survives logout. On a machine two owners have both used, the last one to
 * link owns the cookie — so the first owner's session correctly reports "this
 * is not your terminal" and offers setup again. That part was right.
 *
 * What was wrong: setup could only CREATE, and terminal names are unique per
 * restaurant among live devices. The owner's own old row still held "Terminal
 * 1", so re-typing it was refused as a duplicate and the only way forward was
 * to invent a new name for the same physical till.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB here, so the round trip is not exercised — that lives in
 * tests/integration/onboarding-flow.test.mjs. What is exercised, for real: the
 * schemas, the live auth wall over HTTP, and a structural audit of the
 * handlers with comments stripped.
 */
process.env.NODE_ENV = 'development';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/verdant_pos_test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.PIN_PEPPER = 'c'.repeat(64);
process.env.INVOICE_TOKEN_PEPPER = 'v'.repeat(64);
process.env.DEVICE_TOKEN_PEPPER = 'd'.repeat(64);
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
process.env.LOG_LEVEL = 'error';

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
/** Source with comments removed, so prose about a guard is never the guard. */
const code = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

const { linkDeviceSchema, renameDeviceSchema, relinkDeviceSchema, deviceIdParamSchema } =
  await import('../src/validators/devices.js');
const { AUDIT_ACTION, AUDIT_ACTION_VALUES } = await import('../src/constants/enums.js');
const { default: app } = await import('../app.js');

for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (err) => {
    console.error(`\n!! ${signal}: ${err?.stack ?? err}`);
    process.exit(1);
  });
}

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};
const ok = (schema, input) => schema.safeParse(input).success;

console.log('--- schemas ---');
t('a terminal name is required', !ok(linkDeviceSchema, {}));
t('...at least 2 characters', !ok(linkDeviceSchema, { name: 'A' }));
t('...at most 60', !ok(linkDeviceSchema, { name: 'x'.repeat(61) }));
t('a valid name is accepted', ok(linkDeviceSchema, { name: 'Front counter' }));
t('rename shares those bounds', ok(renameDeviceSchema, { name: 'Front counter' })
  && !ok(renameDeviceSchema, { name: 'A' }));
/*
 * The token is minted server-side and never accepted from a caller: a
 * caller-supplied device token would be a caller-supplied answer to "which
 * restaurant is this?", the one question the whole mechanism exists to answer.
 */
t('a caller cannot propose a token when linking', !ok(linkDeviceSchema, { name: 'Till', token: 'x' }));
t('...nor when renaming', !ok(renameDeviceSchema, { name: 'Till', tokenHash: 'x' }));
t('...nor smuggle a tenantId', !ok(linkDeviceSchema, { name: 'Till', tenantId: 'x'.repeat(24) }));
t('re-linking takes no body at all', ok(relinkDeviceSchema, {}));
t('...and a stray key in it is a 400, not silence', !ok(relinkDeviceSchema, { name: 'Till' }));
t('the id must be an ObjectId', ok(deviceIdParamSchema, { id: 'a'.repeat(24) })
  && !ok(deviceIdParamSchema, { id: 'nope' }));

console.log('\n--- the handlers ---');
{
  const ctl = code('src/controllers/deviceController.js');
  const routes = code('src/routes/devices.js');
  const appSrc = code('app.js');

  const linkBlock = ctl.slice(ctl.indexOf('export const linkDevice'), ctl.indexOf('export const relinkDevice'));
  const relinkBlock = ctl.slice(ctl.indexOf('export const relinkDevice'), ctl.indexOf('export const renameDevice'));

  console.log('     · a name is no longer permanently burned');
  t('a collision is refused with a code the client can act on',
    /code: 'TERMINAL_NAME_TAKEN'/.test(ctl));
  t('...checked before the write, so the message is specific',
    /findActiveByName\(name\)[\s\S]{0,80}nameTakenError/.test(linkBlock));
  t('...and again on the duplicate-key race',
    /err\?\.code === 11000/.test(linkBlock));
  /*
   * The unique index carries collation strength 2, so "terminal 1" and
   * "Terminal 1" collide in the database. A pre-check comparing exactly would
   * pass and then be refused — the exact confusion it exists to prevent.
   */
  t('the pre-check matches the index collation, not exact case',
    /collation\(\{ locale: 'en', strength: 2 \}\)/.test(ctl));

  console.log('     · re-linking is a first-class verb');
  t('re-link mints a NEW token rather than reusing one',
    /mintDeviceToken\(\)/.test(relinkBlock) && /device\.tokenHash = hashDeviceToken/.test(relinkBlock));
  t('...and sets it as an httpOnly cookie, never a response body',
    /res\.cookie\(DEVICE_COOKIE/.test(relinkBlock) && !/token[,}]/.test(relinkBlock.split('sendSuccess')[1] ?? ''));
  t('a retired terminal cannot be re-linked', /!device\.isActive/.test(relinkBlock));
  t('lastSeenAt resets, so one browser never inherits another\'s shifts',
    /device\.lastSeenAt = null/.test(relinkBlock));
  t('it is audited under its own action, not as an ordinary link',
    /AUDIT_ACTION\.DEVICE_RELINK/.test(relinkBlock));
  t('DEVICE_RELINK is a declared audit action',
    AUDIT_ACTION_VALUES.includes(AUDIT_ACTION.DEVICE_RELINK));
  t('DEVICE_RENAME is too', AUDIT_ACTION_VALUES.includes(AUDIT_ACTION.DEVICE_RENAME));
  /*
   * The lookup is Device.findById with no explicit tenant filter, and that is
   * correct: the tenantScoped plugin adds one to every query, so another
   * restaurant's terminal is not found rather than found and then refused.
   */
  t('re-link resolves the terminal through the tenant-scoped model',
    /Device\.findById\(req\.params\.id\)/.test(relinkBlock));

  console.log('     · every route is behind the same wall as before');
  t('the router requires a session', /router\.use\(requireAuth\(\)\)/.test(routes));
  t('...and user:manage, the authority that issues the PINs it enables',
    /router\.use\(requirePermission\(PERMISSIONS\.USER_MANAGE\)\)/.test(routes));
  for (const [verb, route] of [['post', "'/:id/relink'"], ['patch', "'/:id'"], ['delete', "'/:id'"]]) {
    t(`${verb.toUpperCase()} ${route} validates its params`,
      new RegExp(`router\\.${verb}\\(\\s*${route}[\\s\\S]{0,200}deviceIdParamSchema`).test(routes));
  }

  console.log('     · mounted inside the device cookie\'s path');
  /*
   * The cookie is scoped to /api/auth. At /api/devices these handlers could
   * SET it but never READ it, which silently disabled unlinkDevice's "am I
   * unlinking the machine I am sitting at?" check — a stale cookie left behind
   * on the very browser that asked for the unlink.
   */
  t('device routes live under /api/auth', /'\/api\/auth\/devices', deviceRoutes/.test(appSrc));
  t('the cookie is still scoped to /api/auth', /path: '\/api\/auth'/.test(code('src/utils/jwt.js')));
  t('so the self-unlink check can actually run',
    /req\.cookies\?\.\[DEVICE_COOKIE\][\s\S]{0,140}clearCookie\(DEVICE_COOKIE/.test(ctl));
}

console.log('\n--- the auth wall, over live HTTP ---');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

for (const [method, route] of [
  ['GET', '/api/auth/devices'],
  ['POST', '/api/auth/devices'],
  ['POST', '/api/auth/devices/507f1f77bcf86cd799439011/relink'],
  ['PATCH', '/api/auth/devices/507f1f77bcf86cd799439011'],
  ['DELETE', '/api/auth/devices/507f1f77bcf86cd799439011'],
]) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  t(`${method} ${route} -> 401 without a session`, res.status === 401, `got ${res.status}`);
}

// The old path must not still answer, or two mounts would diverge unnoticed.
{
  const res = await fetch(`${baseUrl}/api/devices`);
  t('the old /api/devices mount is gone', res.status === 404, `got ${res.status}`);
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
