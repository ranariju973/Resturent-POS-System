/**
 * Phase 11 — automated route coverage sweep.
 *
 * ── Why this is a script and not a checklist ───────────────────────────────
 * A hand-run checklist tells you what someone remembered to look at on the day
 * they looked. This parses EVERY route file, enumerates EVERY declared route,
 * and reports any that lacks authentication, a permission, or input validation.
 * It fails the build rather than producing a document, so a route added in six
 * months cannot quietly skip the wall.
 *
 * The known, deliberate exceptions are listed explicitly below. Anything not
 * on that list must be guarded.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'src/routes');

let pass = 0;
let fail = 0;
const t = (label, cond, note = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

/**
 * Routes that intentionally lack one of the usual guards, each with the reason.
 * Adding to this list is a deliberate act; forgetting a guard is not.
 */
const EXEMPTIONS = {
  'health.js GET /health':
    'Public liveness probe. Returns no data about the business.',
  'auth.js POST /google':
    'Cannot require a session to create one. The Google ID token is verified '
    + 'cryptographically against Google\'s published keys (signature, iss, aud, exp) '
    + 'plus an email_verified check, and the route is rate-limited by loginLimiter.',
  'auth.js POST /register':
    'Cannot require a session to create one. Bounded by signupLimiter, which '
    + '(unlike loginLimiter) counts SUCCESSES too, because a success is what '
    + 'costs anything here. The account it creates has no restaurant and can '
    + 'reach only GET /auth/me and POST /tenants until it names one.',
  'auth.js POST /login/password':
    'Same. Rate-limited by loginLimiter and account-locked with the same '
    + 'progressive backoff as the PIN door, and every failure — unknown email, '
    + 'wrong password, Google-only account — returns one indistinguishable '
    + 'message after an equal-time bcrypt burn.',
  'auth.js POST /login/staff':
    'Same. Rate-limited and account-locked. The restaurant is resolved from the '
    + 'terminal\'s device cookie BEFORE the PIN is matched, so a PIN is only ever '
    + 'compared within one restaurant.',
  'auth.js POST /refresh':
    'Authenticated by the httpOnly refresh cookie, not a bearer token.',
  'auth.js POST /logout':
    'Deliberately open: an expired access token must not prevent ending a session.',
  'kitchen.js GET /stream':
    'EventSource cannot set headers. Verifies a 60s single-purpose token in-handler and re-checks kitchen:view against the database.',
  'terminal.js GET /':
    'The login screen must name the restaurant before anyone has a session. Reads '
    + 'only the device cookie and returns two names — nothing about any account, '
    + 'staff member or PIN. An unlinked terminal gets { linked: false }, not an error.',
  'invoice.js GET /:slug':
    'A customer opening a receipt link has no session and never will. Authenticated by a 192-bit token in the URL, hashed at rest; the response is a separate serialiser carrying no staff identity, no internal ids and no phone number.',
};

const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'));

/** Strip comments so prose about a guard is never mistaken for the guard. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

/**
 * Split a router file into one block per declared route, so a guard on route A
 * cannot be credited to route B.
 *
 * ── Why this slices rather than pattern-matches whole declarations ─────────
 * It used to run two regexes: one for a multi-line middleware chain, ending at
 * the first `\n);`, and one for a single-line declaration. A non-greedy body
 * has no idea where a route STOPS, so a single-line route sitting above a
 * multi-line one swallowed everything between them — and the routes in the
 * middle vanished from the sweep entirely.
 *
 * That is the one failure this file exists to make impossible: a route that is
 * never enumerated is indistinguishable from a route that is properly guarded.
 * It is how POST /api/auth/login/password — an unauthenticated login endpoint —
 * passed the sweep without ever being looked at.
 *
 * Slicing on the declaration boundary removes the guesswork. Every route's
 * block runs to the start of the next declaration, so nothing can be absorbed
 * and nothing can be skipped, whatever the formatting.
 */
function parseRoutes(source) {
  const code = stripComments(source);

  /*
   * Where the router-wide guards start applying — a POSITION, not a boolean.
   *
   * `router.use()` is middleware, so it covers only what is declared AFTER it.
   * kitchen.js relies on that: GET /stream sits deliberately above
   * `router.use(requireAuth())` because EventSource cannot send an
   * Authorization header, so the handler verifies a single-purpose token
   * itself. Treating the guard as file-wide reported that route as protected
   * by a wall it is explicitly in front of — the sweep asserting the opposite
   * of the truth about the one route where it mattered most.
   *
   * Infinity when the guard is absent, so "declared after it" is never true.
   */
  const guardAt = (pattern) => {
    const at = code.search(pattern);
    return at === -1 ? Infinity : at;
  };
  const routerWide = {
    auth: guardAt(/router\.use\(requireAuth\(\)\)/),
    permission: guardAt(/router\.use\(requirePermission\(/),
  };

  // Every declaration's position, so each body can be bounded by the next one.
  const decl = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g;
  const found = [];
  let m;
  while ((m = decl.exec(code)) !== null) {
    // `at` bounds the PREVIOUS route's body; `from` starts this one's.
    found.push({ method: m[1].toUpperCase(), path: m[2], at: m.index, from: decl.lastIndex });
  }

  return found.map((route, i) => {
    const body = code.slice(route.from, found[i + 1]?.at ?? code.length);
    const underAuth = route.at > routerWide.auth;

    /*
     * Router-wide guards are removed before the INLINE check.
     *
     * A route's block runs to the next declaration, so any `router.use()`
     * sitting between them falls inside it — and kitchen.js puts
     * `router.use(requireAuth())` immediately after GET /stream precisely
     * because that route must NOT be covered by it. Testing the raw block
     * credited the route with the very guard it was declared in front of.
     */
    const inline = body.replace(/router\.use\([\s\S]*?\);/g, '');

    return {
      method: route.method,
      path: route.path,
      body: inline,
      hasAuth: underAuth || /requireAuth\(\)/.test(inline),
      hasPermission:
        route.at > routerWide.permission
        || /requirePermission\(|requireAnyPermission\(|requireAllPermissions\(/.test(inline),
      hasValidation: /validate\(\{/.test(inline),
      routerWideAuth: underAuth,
    };
  });
}

// ---------------------------------------------------------------------------
console.log('--- enumerating every declared route ---');

const all = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
  for (const route of parseRoutes(source)) {
    all.push({ ...route, file, key: `${file} ${route.method} ${route.path}` });
  }
}

console.log(`     ${files.length} route files, ${all.length} routes\n`);
for (const file of files) {
  const count = all.filter((r) => r.file === file).length;
  console.log(`     ${file.padEnd(16)} ${count} routes`);
}

// A file that parses to zero routes is indistinguishable from a clean one,
// so it is an explicit failure rather than a silent pass.
t(`every one of the ${files.length} route files parsed to at least one route`,
  files.every((f) => all.some((r) => r.file === f)),
  files.filter((f) => !all.some((r) => r.file === f)).join(', '));
t('the total is what the API actually exposes', all.length >= 45, `${all.length}`);

// ---------------------------------------------------------------------------
console.log('\n--- 1. every route requires authentication ---');
{
  const unguarded = all.filter((r) => !r.hasAuth && !(r.key in EXEMPTIONS));
  for (const r of unguarded) console.log(`     UNGUARDED: ${r.key}`);
  t('no route is missing authentication', unguarded.length === 0,
    unguarded.length ? `${unguarded.length} route(s)` : '');

  const exempt = all.filter((r) => !r.hasAuth);
  t(`${exempt.length} exemptions, every one of them declared`,
    exempt.every((r) => r.key in EXEMPTIONS),
    exempt.filter((r) => !(r.key in EXEMPTIONS)).map((r) => r.key).join(', '));

  console.log('\n     Declared exemptions:');
  for (const r of exempt) console.log(`       ${r.key}\n         ${EXEMPTIONS[r.key]}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 2. every route names a permission (reads included) ---');
{
  /*
   * Auth routes gate on session identity, not on a permission; health is
   * public.
   *
   * `tenants.js POST /` is the one data route that genuinely cannot name a
   * permission. It is reached by a Google account that has authenticated but
   * does not yet belong to a restaurant, and permissions are derived from a
   * role WITHIN one — there is nothing for it to hold yet. What stands in
   * place of a permission is the handler's own refusal when the account
   * already has a restaurant, which makes it callable exactly once per
   * account. It IS behind requireAuth().
   */
  const NO_PERMISSION_NEEDED = new Set(
    Object.keys(EXEMPTIONS).concat(['auth.js GET /me', 'tenants.js POST /']),
  );
  const unguarded = all.filter((r) => !r.hasPermission && !NO_PERMISSION_NEEDED.has(r.key));
  for (const r of unguarded) console.log(`     NO PERMISSION: ${r.key}`);
  t('no data route is missing a permission', unguarded.length === 0,
    unguarded.length ? `${unguarded.length} route(s)` : '');

  // The point of the "reads are guarded too" rule.
  const reads = all.filter(
    (r) => r.method === 'GET' && !NO_PERMISSION_NEEDED.has(r.key),
  );
  t(`all ${reads.length} GET routes carry a permission`,
    reads.every((r) => r.hasPermission),
    reads.filter((r) => !r.hasPermission).map((r) => r.key).join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n--- 3. every route taking input validates it ---');
{
  // A route with no params, no body and no query has nothing to validate.
  const NO_INPUT = new Set([
    'health.js GET /health',
    'auth.js POST /refresh',
    'auth.js GET /me',
    'kitchen.js GET /stream',
    'kitchen.js POST /stream-token',
    'tables.js GET /zones',
    'menu.js GET /categories',
  ]);

  const takesInput = all.filter(
    (r) => (r.path.includes(':') || ['POST', 'PUT', 'PATCH'].includes(r.method)) && !NO_INPUT.has(r.key),
  );
  const unvalidated = takesInput.filter((r) => !r.hasValidation);
  for (const r of unvalidated) console.log(`     UNVALIDATED: ${r.key}`);
  t(`all ${takesInput.length} input-taking routes run validate()`, unvalidated.length === 0,
    unvalidated.map((r) => r.key).join(', '));

  // A path parameter that is never validated is an unchecked ObjectId cast.
  const withParams = all.filter((r) => r.path.includes(':') && !NO_INPUT.has(r.key));
  t(`all ${withParams.length} parameterised routes validate their params`,
    withParams.every((r) => /params:/.test(r.body)),
    withParams.filter((r) => !/params:/.test(r.body)).map((r) => r.key).join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n--- 4. schemas are allow-lists, not deny-lists ---');
{
  const VALIDATORS = path.join(ROOT, 'src/validators');
  const validatorFiles = fs.readdirSync(VALIDATORS).filter((f) => f.endsWith('.js'));

  let objects = 0;
  let strict = 0;
  for (const file of validatorFiles) {
    const code = stripComments(fs.readFileSync(path.join(VALIDATORS, file), 'utf8'));
    objects += (code.match(/\.object\(\{/g) ?? []).length;
    strict += (code.match(/\.strict\(\)/g) ?? []).length;
  }

  console.log(`     ${validatorFiles.length} validator files, ${objects} object schemas, ${strict} .strict() calls`);
  // Nested sub-schemas (order lines, etc.) inherit strictness from their parent,
  // so the counts need not match exactly — but most objects must be strict.
  t('the large majority of schemas reject unknown keys', strict >= objects * 0.7,
    `${strict}/${objects}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 5. no authorisation logic outside the permission map ---');
{
  const dirs = ['src/controllers', 'src/routes', 'src/middleware'];
  const offenders = [];

  for (const dir of dirs) {
    for (const file of fs.readdirSync(path.join(ROOT, dir))) {
      if (!file.endsWith('.js')) continue;
      const code = stripComments(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'));

      // The pattern that scatters authorisation across the codebase.
      if (/role\s*===\s*['"]admin['"]/.test(code)) offenders.push(`${dir}/${file}: role === 'admin'`);
      if (/role\s*!==\s*['"]cashier['"]/.test(code)) offenders.push(`${dir}/${file}: deny-list role check`);
      if (/user\.role\s*===\s*['"]/.test(code) && !file.includes('permissions')) {
        offenders.push(`${dir}/${file}: direct role comparison`);
      }
    }
  }

  for (const o of offenders) console.log(`     ${o}`);
  t('no controller branches on a role string directly', offenders.length === 0,
    offenders.join('; '));
}

// ---------------------------------------------------------------------------
console.log('\n--- 6. credentials and PII cannot reach a response ---');
{
  const models = path.join(ROOT, 'src/models');
  const user = fs.readFileSync(path.join(models, 'User.js'), 'utf8');

  for (const field of [
    'passwordHash', 'pinHash', 'pinLookup',
    'overridePinHash', 'overridePinLookup', 'tokenVersion',
  ]) {
    t(`User.toJSON strips ${field}`, new RegExp(`delete ret\\.${field};`).test(user));
    t(`  ...and ${field} is select:false`,
      new RegExp(`${field}: \\{[^}]*select: false`).test(user));
  }

  // No controller may hand back a raw user document.
  const controllers = path.join(ROOT, 'src/controllers');
  const leaks = [];
  for (const file of fs.readdirSync(controllers)) {
    const code = stripComments(fs.readFileSync(path.join(controllers, file), 'utf8'));
    // A LEAK is returning the document itself — `{ user }`, `{ user: user }`
    // or `res.json(user)`. `req.user.id` appearing inside a payload is not a
    // leak, and matching it produced a false positive on kitchenController.
    const returnsRawUser =
      /sendSuccess\([^;]*\{\s*user\s*[,}]/.test(code) ||
      /sendSuccess\([^;]*user:\s*user\b/.test(code) ||
      /res\.json\(\s*user\s*\)/.test(code);
    if (returnsRawUser && !/publicUser/.test(code)) leaks.push(file);
  }
  t('no controller returns a raw user document', leaks.length === 0, leaks.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n--- 7. rate limiting and payload caps are mounted ---');
{
  const app = stripComments(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  t('the general API limiter is mounted', /app\.use\('\/api', apiLimiter\)/.test(app));
  t('mongo-operator sanitising is mounted', /app\.use\('\/api', sanitizeRequest\)/.test(app));
  t('query complexity is capped', /limitQueryComplexity/.test(app));
  t('json body size is capped', /express\.json\(\{ limit:/.test(app));
  t('sanitising runs BEFORE rate limiting (so probes are logged even when throttled)',
    app.indexOf('sanitizeRequest') < app.indexOf('apiLimiter'));

  const auth = stripComments(fs.readFileSync(path.join(ROOT, 'src/routes/auth.js'), 'utf8'));
  {
    // Count usages in ROUTE DECLARATIONS only — the import line is not a usage,
    // and counting it made this assertion expect the wrong number.
    const declarations = auth.split('\n').filter((l) => /^router\.(post|get)/.test(l));
    const limited = declarations.filter((l) => /loginLimiter/.test(l));
    t('both login routes carry the strict limiter', limited.length === 2,
      `${limited.length} of ${declarations.filter((l) => /login\//.test(l)).length} login routes`);
  }
  t('refresh carries its own limiter', /refreshLimiter/.test(auth));
}

// ---------------------------------------------------------------------------
console.log('\n--- 8. errors never leak internals in production ---');
{
  const handler = fs.readFileSync(path.join(ROOT, 'src/middleware/errorHandler.js'), 'utf8');
  t('stack traces are development-only', /if \(!env\.isProd && isServerFault/.test(handler));
  t('unknown routes get a generic 404', /Resource not found/.test(handler));
  t('every JWT error collapses to one message', /Authentication required/.test(handler));
  t('duplicate-key errors name the field but not the value',
    /A record with that \$\{field\} already exists/.test(handler));
  t('a 4xx on a plain Error is honoured rather than becoming a 500',
    /err\.status >= 400 && err\.status < 500/.test(handler));
}

// ---------------------------------------------------------------------------
console.log('\n--- 9. the audit trail covers the actions that matter ---');
{
  const controllers = path.join(ROOT, 'src/controllers');
  const allCode = fs
    .readdirSync(controllers)
    .map((f) => fs.readFileSync(path.join(controllers, f), 'utf8'))
    .join('\n');

  const REQUIRED = [
    ['LOGIN_SUCCESS', 'successful sign-in'],
    ['LOGIN_FAILURE', 'failed sign-in'],
    ['LOGOUT', 'sign-out'],
    ['ACCOUNT_LOCKED', 'lockout'],
    ['ORDER_CREATE', 'order placed'],
    ['ORDER_PAY', 'payment taken'],
    ['ORDER_VOID', 'order voided'],
    ['ORDER_DISCOUNT_OVERRIDE', 'manager-approved discount'],
    ['MENU_ITEM_PRICE_CHANGE', 'price change'],
    ['TABLE_DELETE', 'table removed'],
    ['CUSTOMER_DELETE', 'customer removed'],
    ['EXPENSE_CREATE', 'expense recorded'],
    ['TICKET_ADVANCE', 'kitchen transition'],
  ];

  for (const [action, description] of REQUIRED) {
    t(`${description} is audited`, allCode.includes(`AUDIT_ACTION.${action}`));
  }

  const auditModel = fs.readFileSync(path.join(ROOT, 'src/models/AuditLog.js'), 'utf8');
  t('audit entries are immutable', /Audit log entries are immutable/.test(auditModel));
  t('audit meta is redacted before it is stored', /scrubMeta/.test(auditModel));
  t('a failed audit write never fails the operation it was auditing',
    /catch \(err\)[\s\S]{0,200}return null;/.test(auditModel));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
