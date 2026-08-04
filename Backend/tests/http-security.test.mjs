/**
 * Live HTTP security tests.
 *
 * Unlike the static audits, this boots the REAL Express app on an ephemeral
 * port and makes real requests against it with fetch. Every assertion below is
 * about an actual response the server produced.
 *
 * No database is needed: nothing here touches a route that queries Mongo.
 * The health check reports `db: down`, which is correct and expected.
 *
 * Env is stubbed before app.js is imported, because src/config/env.js
 * validates at module load and would exit the process otherwise.
 */
process.env.NODE_ENV = 'development';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/verdant_pos_test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.PIN_PEPPER = 'c'.repeat(64);
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JSON_BODY_LIMIT = '10kb';

const { default: app } = await import('../app.js');

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

let probeServer = null;
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const get = (path, init) => fetch(`${base}${path}`, init);
const postJson = (path, body, init = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

try {
  // -------------------------------------------------------------------------
  console.log('--- security headers on a real response ---');
  const health = await get('/api/health');
  const h = health.headers;

  t('responds', health.status === 200 || health.status === 503, `status ${health.status}`);
  t('X-Powered-By is absent (framework not advertised)', h.get('x-powered-by') === null);
  t('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff');
  t('X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY');
  t('Referrer-Policy: no-referrer', h.get('referrer-policy') === 'no-referrer');
  t('Content-Security-Policy present', Boolean(h.get('content-security-policy')));
  t("CSP default-src is 'none' (deny-all for a JSON API)",
    (h.get('content-security-policy') ?? '').includes("default-src 'none'"));
  t('CSP has no wildcard source', !(h.get('content-security-policy') ?? '').includes('*'));
  t('Permissions-Policy denies camera/mic/geo',
    (h.get('permissions-policy') ?? '').includes('camera=()'));
  t('X-Request-Id echoed for log correlation', Boolean(h.get('x-request-id')));
  t('Cross-Origin-Opener-Policy set', Boolean(h.get('cross-origin-opener-policy')));
  t('no HSTS in development (there is no TLS to pin)', h.get('strict-transport-security') === null);

  // -------------------------------------------------------------------------
  console.log('\n--- health check leaks nothing ---');
  const healthBody = await health.json();
  const healthText = JSON.stringify(healthBody);
  t('reports status and db state', 'status' in healthBody.data && 'db' in healthBody.data);
  t('no mongo URI in the body', !healthText.includes('mongodb'));
  t('no version or dependency list', !/version|node_modules|express/i.test(healthText));
  t('no hostname', !healthText.includes('127.0.0.1'));

  // -------------------------------------------------------------------------
  console.log('\n--- unknown routes ---');
  const missing = await get('/api/does-not-exist');
  const missingBody = await missing.json();
  t('404 status', missing.status === 404);
  t('JSON, not an HTML stack-trace page',
    (missing.headers.get('content-type') ?? '').includes('application/json'));
  t('generic message', missingBody.error?.message === 'Resource not found');
  t('carries a request id', Boolean(missingBody.requestId));
  t('no stack trace in the body', !JSON.stringify(missingBody).includes('at '));

  // -------------------------------------------------------------------------
  console.log('\n--- CORS ---');
  const allowed = await get('/api/health', { headers: { Origin: 'http://localhost:5173' } });
  t('allow-listed origin is permitted',
    allowed.headers.get('access-control-allow-origin') === 'http://localhost:5173');
  t('credentials allowed for the refresh cookie',
    allowed.headers.get('access-control-allow-credentials') === 'true');

  const evil = await get('/api/health', { headers: { Origin: 'https://evil.example' } });
  t('disallowed origin is NOT reflected back',
    evil.headers.get('access-control-allow-origin') === null,
    `got ${evil.headers.get('access-control-allow-origin')}`);

  const preflight = await fetch(`${base}/api/auth/login/admin`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST',
    },
  });
  t('preflight from a disallowed origin gets no allow header',
    preflight.headers.get('access-control-allow-origin') === null);

  // -------------------------------------------------------------------------
  console.log('\n--- body size limit ---');
  const huge = await postJson('/api/auth/login/admin', { email: 'a@b.co', password: 'x'.repeat(50_000) });
  t('oversized body rejected with 413', huge.status === 413, `status ${huge.status}`);
  const hugeBody = await huge.json();
  t('rejection is a clean envelope', hugeBody.success === false && Boolean(hugeBody.error?.message));

  // -------------------------------------------------------------------------
  console.log('\n--- malformed input ---');
  const badJson = await postJson('/api/auth/login/admin', '{not valid json');
  t('malformed JSON is a 400, not a 500', badJson.status === 400, `status ${badJson.status}`);
  const badJsonBody = await badJson.json();
  t('no parser internals leaked', !JSON.stringify(badJsonBody).toLowerCase().includes('json.parse'));

  // -------------------------------------------------------------------------
  console.log('\n--- NoSQL injection ---');
  // The classic auth bypass: operators instead of values.
  const injected = await postJson('/api/auth/login/admin', {
    email: { $ne: null },
    password: { $ne: null },
  });
  t('operator payload does NOT authenticate',
    injected.status !== 200, `status ${injected.status}`);
  const injectedBody = await injected.json();
  t('rejected before reaching the database', injectedBody.success === false);
  t('no access token issued', !JSON.stringify(injectedBody).includes('accessToken'));

  // Operators in the query string are stripped too.
  const injectedQuery = await get('/api/health?%24where=1&role[$ne]=admin');
  t('operator query params do not crash the request',
    injectedQuery.status === 200 || injectedQuery.status === 503);

  // Dotted keys — the nested-path variant of the same trick.
  const dotted = await postJson('/api/auth/login/admin', { 'user.role': 'admin', email: 'a@b.co', password: 'xxxxxxxx' });
  t('dotted keys do not authenticate', dotted.status !== 200, `status ${dotted.status}`);

  // The assertions above prove the request was refused, but not WHY — with no
  // database running, a 500 would look the same. This mounts the real
  // sanitiser on a throwaway app that echoes what reached the handler, so the
  // stripping itself is observed rather than inferred.
  const echoPort = await (async () => {
    const express = (await import('express')).default;
    const { sanitizeRequest } = await import('../src/middleware/sanitize.js');
    const probe = express();
    probe.use(express.json());
    probe.use(sanitizeRequest);
    probe.post('/echo', (req, res) => res.json({ body: req.body, query: req.query }));
    probe.get('/echo', (req, res) => res.json({ query: req.query }));
    const s = probe.listen(0);
    await new Promise((r) => s.once('listening', r));
    probeServer = s;
    return s.address().port;
  })();

  const echo = async (body) => {
    const r = await fetch(`http://127.0.0.1:${echoPort}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  };

  const stripped = await echo({ email: { $ne: null }, password: { $gt: '' } });
  t('$ne is removed from the body',
    !JSON.stringify(stripped.body).includes('$ne'), JSON.stringify(stripped.body));
  t('$gt is removed from the body', !JSON.stringify(stripped.body).includes('$gt'));
  t('the operator object is emptied, not replaced with something truthy',
    Object.keys(stripped.body.email ?? {}).length === 0);

  const nested = await echo({ filter: { user: { $where: 'sleep(5000)' } } });
  t('$where is removed even when nested two levels deep',
    !JSON.stringify(nested.body).includes('$where'));

  const dottedEcho = await echo({ 'user.role': 'admin', name: 'ok' });
  t('dotted key removed from the body',
    !Object.keys(dottedEcho.body).includes('user.role'), JSON.stringify(dottedEcho.body));
  t('legitimate sibling field survives', dottedEcho.body.name === 'ok');

  const queryEcho = await (
    await fetch(`http://127.0.0.1:${echoPort}/echo?role[$ne]=admin&page=2`)
  ).json();
  t('operator in the query string removed',
    !JSON.stringify(queryEcho.query).includes('$ne'), JSON.stringify(queryEcho.query));
  t('ordinary query params survive', queryEcho.query.page === '2');

  const untouched = await echo({ email: 'a@b.co', qty: 3, note: 'costs $5', nested: { ok: true } });
  t('normal payloads pass through unchanged',
    untouched.body.email === 'a@b.co' && untouched.body.qty === 3 && untouched.body.nested.ok === true);
  t('a $ inside a VALUE is not touched (only keys matter)',
    untouched.body.note === 'costs $5');

  // -------------------------------------------------------------------------
  console.log('\n--- schema validation rejects unknown keys ---');
  const extra = await postJson('/api/auth/login/admin', {
    email: 'a@b.co',
    password: 'xxxxxxxx',
    role: 'admin', // privilege-escalation attempt
  });
  t('unknown field is a 400, not silently stripped', extra.status === 400, `status ${extra.status}`);
  const extraBody = await extra.json();
  t('validation error names the offending field',
    JSON.stringify(extraBody.error?.details ?? '').includes('role'));

  // -------------------------------------------------------------------------
  console.log('\n--- authentication is required ---');
  const noToken = await get('/api/auth/me');
  t('protected route without a token is 401', noToken.status === 401);
  const noTokenBody = await noToken.json();
  t('generic message (no account enumeration)',
    noTokenBody.error?.message === 'Authentication required');

  const forged = await get('/api/auth/me', {
    headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0.' },
  });
  t("alg:none forgery rejected", forged.status === 401);
  const forgedBody = await forged.json();
  t('forged token gets the SAME message as a missing one',
    forgedBody.error?.message === noTokenBody.error?.message);

  // -------------------------------------------------------------------------
  console.log('\n--- oversized query string ---');
  const manyKeys = Array.from({ length: 60 }, (_, i) => `k${i}=1`).join('&');
  const bloated = await get(`/api/health?${manyKeys}`);
  t('query with 60 params rejected', bloated.status === 400, `status ${bloated.status}`);

  // -------------------------------------------------------------------------
  console.log('\n--- rate limiting ---');
  // NODE_ENV is 'development' here, so limiters are active (they are skipped
  // only under NODE_ENV=test).
  const burst = [];
  for (let i = 0; i < 8; i += 1) {
    burst.push(await postJson('/api/auth/login/admin', { email: 'nobody@example.com', password: 'wrongpassword' }));
  }
  const statuses = burst.map((r) => r.status);
  const limited = statuses.filter((s) => s === 429).length;
  t('login limiter engages within 8 failed attempts', limited > 0,
    `statuses: ${statuses.join(',')}`);
  const limitedRes = burst.find((r) => r.status === 429);
  if (limitedRes) {
    const limitedBody = await limitedRes.json();
    t('429 uses the standard error envelope', limitedBody.success === false);
    t('429 message does not reveal the limit',
      !/\d/.test(limitedBody.error?.message ?? ''), limitedBody.error?.message);
    t('RateLimit headers present', Boolean(limitedRes.headers.get('ratelimit')));
  }

  const healthAfter = await get('/api/health');
  t('the general limiter did not also block health',
    healthAfter.status === 200 || healthAfter.status === 503);
} finally {
  await new Promise((r) => server.close(r));
  if (probeServer) await new Promise((r) => probeServer.close(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
