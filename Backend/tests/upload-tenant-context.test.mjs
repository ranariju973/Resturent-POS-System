/**
 * Regression: the menu-image upload lost the restaurant (tenant) context.
 *
 * ── The bug ────────────────────────────────────────────────────────────────
 * requireAuth enters the tenant with `runInTenant(id, () => next())`, and
 * everything downstream relies on AsyncLocalStorage carrying that tenant into
 * each query. multer breaks the chain: it pipes the request into busboy and
 * calls its callback from busboy's `finish` event, and stream events run in
 * the async context of whatever pushed the data — the incoming socket — not
 * the context multer was called from.
 *
 * Whether that mattered depended on timing, which is why it looked like a
 * Windows problem. When the auth lookup awaited the database, the body had
 * usually finished arriving and was already buffered, so busboy drained it on
 * a tick scheduled inside the tenant context and the request worked. Once the
 * user was in the 30-second auth cache, auth finished synchronously, the body
 * was still in flight, and every chunk arrived from the socket's context.
 * `Category.findOne` then ran with no tenant and the tenant guard threw:
 * POST /api/menu/items -> 500 "Something went wrong".
 *
 * Reproduced against a running server before the fix: the first create after
 * a cold cache returned 201, and every create after it returned 500.
 *
 * ── What this test does ────────────────────────────────────────────────────
 * Calls the real `uploadImage` middleware inside `runInTenant`, then feeds the
 * multipart body from OUTSIDE any tenant context, the way a slow network
 * delivers it, and checks the tenant is still visible when multer hands over.
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

import { PassThrough } from 'node:stream';

const { uploadImage } = await import('../src/middleware/upload.js');
const { runInTenant, getTenantId } = await import('../src/utils/tenantContext.js');

let passed = 0;
let failed = 0;
const t = (name, ok) => {
  if (ok) { passed += 1; console.log(`PASS ${name}`); } else { failed += 1; console.log(`FAIL ${name}`); }
};

const TENANT = '6a8cc7fdd844ff28d0364918';
const BOUNDARY = '----kimcheBoundary7MA4YWxkTrZu0gW';

/** A real multipart body: text fields plus a small JPEG part. */
function multipartBody({ withFile }) {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
  const parts = [
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nMomo\r\n`,
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="price"\r\n\r\n120\r\n`,
  ].map((s) => Buffer.from(s));
  if (withFile) {
    parts.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="image"; filename="photo.jpg"\r\n`
      + 'Content-Type: image/jpeg\r\n\r\n',
    ));
    parts.push(jpeg, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

function fakeRequest(body) {
  const req = new PassThrough();
  req.headers = {
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    'content-length': String(body.length),
  };
  req.method = 'POST';
  return req;
}

/**
 * Run the middleware inside the tenant, but deliver the body later from a
 * context with NO tenant — exactly what a socket does.
 */
function runCase({ withFile, chunked }) {
  return new Promise((resolve) => {
    const body = multipartBody({ withFile });
    const req = fakeRequest(body);
    const middleware = uploadImage('image');

    runInTenant(TENANT, () => {
      middleware(req, {}, (err) => {
        resolve({ err: err ?? null, tenant: getTenantId(), req });
      });
    });

    // Scheduled at top level, outside runInTenant: these writes, and the
    // stream events they trigger, carry no tenant.
    setImmediate(() => {
      if (!chunked) { req.end(body); return; }
      const half = Math.floor(body.length / 2);
      req.write(body.subarray(0, half));
      setImmediate(() => req.end(body.subarray(half)));
    });
  });
}

console.log('--- the tenant survives multer, however the body arrives ---');

for (const [label, opts] of [
  ['body with an image, one chunk', { withFile: true, chunked: false }],
  ['body with an image, two chunks', { withFile: true, chunked: true }],
  ['text fields only, no image', { withFile: false, chunked: false }],
]) {
  const r = await runCase(opts);
  t(`${label}: multer reports no error`, r.err === null);
  t(`${label}: tenant is still in context after multer`, r.tenant === TENANT);
}

{
  const r = await runCase({ withFile: true, chunked: true });
  t('the text fields are still parsed', r.req.body?.name === 'Momo' && r.req.body?.price === '120');
  t('the file is still parsed', Buffer.isBuffer(r.req.file?.buffer) && r.req.file.size === 68);
}

// The control case: the bug needs the body to arrive late. A body that is
// already written when multer starts passes with or without the fix, which is
// why the failure was intermittent rather than constant.
{
  const body = multipartBody({ withFile: true });
  const req = fakeRequest(body);
  req.end(body);
  const r = await new Promise((resolve) => {
    runInTenant(TENANT, () => {
      uploadImage('image')(req, {}, (err) => resolve({ err, tenant: getTenantId() }));
    });
  });
  t('a body already buffered before multer runs keeps the tenant (control)', r.tenant === TENANT);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
