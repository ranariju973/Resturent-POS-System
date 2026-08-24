/**
 * Tenant coverage sweep.
 *
 * ── Why this is a script and not a code review ─────────────────────────────
 * Multi-tenancy is only as good as its least careful model. One collection
 * that forgets `tenantScoped` is one collection every restaurant can read from
 * every other — and it will not look broken, because a query with no tenant
 * filter returns rows perfectly happily.
 *
 * So this enumerates every model and fails the build on any that is neither
 * scoped nor explicitly exempted. A model added in six months cannot quietly
 * skip the wall; someone has to come here and write down why.
 *
 * Modelled on route-coverage.test.mjs, which does the same job for auth.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const ROOT = path.resolve(import.meta.dirname, '..');
const MODELS_DIR = path.join(ROOT, 'src/models');

let pass = 0;
let fail = 0;
const t = (label, cond, note = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

/**
 * Models that deliberately hold no tenantId, each with the reason.
 *
 * Adding to this list is a deliberate act; forgetting the plugin is not.
 */
const EXEMPTIONS = {
  'Tenant.js':
    'IS the restaurant. A tenant cannot be scoped by itself.',
  'Counter.js':
    'The restaurant is inside the string _id — order:<tenantId>:<day> — so the '
    + 'document key already partitions it. nextSequence requires a tenant in context.',
  'RefreshToken.js':
    'Looked up by jti from a cookie before any tenant is known, exactly as a '
    + 'session must be. The authoritative tenant is re-derived from User.tenantId.',
};

await import(`${ROOT}/src/models/index.js`);

const modelFiles = fs
  .readdirSync(MODELS_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'index.js');

console.log('--- every model is scoped, or explicitly exempted ---');

for (const file of modelFiles) {
  const source = fs.readFileSync(path.join(MODELS_DIR, file), 'utf8');
  const scoped = /\.plugin\(tenantScoped/.test(source);
  const exempt = Object.hasOwn(EXEMPTIONS, file);

  if (exempt) {
    t(`${file} is exempt`, !scoped,
      scoped ? 'it is BOTH exempt and scoped — remove one' : EXEMPTIONS[file]);
  } else {
    t(`${file} applies tenantScoped`, scoped,
      scoped ? '' : 'add the plugin, or add an EXEMPTIONS entry saying why not');
  }
}

console.log('\n--- exemptions are real, and still needed ---');
for (const file of Object.keys(EXEMPTIONS)) {
  t(`${file} exists`, fs.existsSync(path.join(MODELS_DIR, file)),
    'a stale exemption silently excuses a file that no longer exists');
}

console.log('\n--- the compiled schemas agree with the sources ---');
/*
 * The check above reads text; this one asks Mongoose. A plugin call that is
 * commented out, or applied to the wrong schema object, passes the regex and
 * fails here.
 */
const EXEMPT_MODEL_NAMES = new Set(['Tenant', 'Counter', 'RefreshToken']);
for (const [name, model] of Object.entries(mongoose.models)) {
  const hasPath = Boolean(model.schema.paths.tenantId);
  const shouldHave = !EXEMPT_MODEL_NAMES.has(name);
  t(`${name} ${shouldHave ? 'has' : 'has no'} tenantId path`, hasPath === shouldHave);
}

console.log('\n--- no unique index is global on a scoped model ---');
/*
 * A unique index that does not lead with tenantId constrains the WHOLE
 * deployment. That is the staff-PIN bug: one restaurant taking a value denies
 * it to every other.
 */
const GLOBAL_UNIQUE_ALLOWED = {
  /*
   * The customer receipt link. An anonymous browser has no session and no
   * restaurant — this 192-bit peppered token is what resolves both, so it
   * cannot be scoped by the thing it resolves.
   */
  Order: new Set(['invoiceTokenHash']),

  /*
   * The Google account id. Sign-in has no restaurant context — discovering
   * which one the person belongs to is the point — so a per-restaurant key
   * would leave the handler unable to decide which row to log in as, and
   * find-or-create would mint a duplicate on every visit. Global uniqueness is
   * what makes one Google account resolve to exactly one row.
   */
  User: new Set(['googleId']),

  /*
   * The terminal binding, and the same pattern as the invoice token: it is
   * looked up BEFORE any restaurant is known, because the lookup is what
   * discovers the restaurant. Unguessable input (256 bits, peppered) means
   * deployment-wide uniqueness costs nothing.
   */
  Device: new Set(['tokenHash']),
};

/*
 * Each entry above is a place where one restaurant's value constrains every
 * other, so the list is asserted rather than merely consulted — adding to it
 * means changing this number, which surfaces in review.
 */
const EXPECTED_GLOBAL_UNIQUE_FIELDS = 3;
t(`${EXPECTED_GLOBAL_UNIQUE_FIELDS} deliberately global unique index(es)`,
  Object.values(GLOBAL_UNIQUE_ALLOWED).reduce((n, set) => n + set.size, 0)
    === EXPECTED_GLOBAL_UNIQUE_FIELDS);

for (const [name, model] of Object.entries(mongoose.models)) {
  if (EXEMPT_MODEL_NAMES.has(name)) continue;

  const offenders = model.schema
    .indexes()
    .filter(([keys, opts]) => opts?.unique && Object.keys(keys)[0] !== 'tenantId')
    .map(([keys]) => Object.keys(keys).join('+'))
    .filter((k) => !GLOBAL_UNIQUE_ALLOWED[name]?.has(k));

  t(`${name} declares no globally-unique index`, offenders.length === 0, offenders.join(', '));
}

console.log('\n--- bulkWrite carries its own tenant filter ---');
/*
 * The one gap the plugin cannot close: Mongoose runs no query middleware on
 * bulkWrite, so its filters must name tenantId by hand.
 */
const controllersDir = path.join(ROOT, 'src/controllers');
const bulkWriteCallers = fs
  .readdirSync(controllersDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, fs.readFileSync(path.join(controllersDir, f), 'utf8')])
  .filter(([, src]) => /\.bulkWrite\(/.test(src));

t('bulkWrite call sites are known', bulkWriteCallers.length > 0,
  `${bulkWriteCallers.length} file(s)`);

for (const [file, src] of bulkWriteCallers) {
  // The tenant must appear inside the bulkWrite argument, not merely somewhere
  // in the file.
  const start = src.indexOf('.bulkWrite(');
  const region = src.slice(start, start + 1200);
  t(`${file} bulkWrite filters on tenantId`, /tenantId/.test(region),
    'Mongoose runs no middleware here — the filter must be explicit');
}

/** Every .js under src/, collected once and reused by the checks below. */
function srcFilesForCacheAudit() {
  const out = [];
  const walkDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walkDir(path.join(ROOT, 'src'));
  return out;
}

console.log('\n--- no cache key is frozen at import time ---');
/*
 * The bug this catches, because it actually happened: menuCache declared
 *
 *     export const MENU_ITEMS_KEY = key('menu', 'items');
 *
 * at module scope. `key()` reads the restaurant from the ambient request
 * context, and at import time there is none — so every restaurant shared one
 * key computed before any request existed. The first menu read on the
 * deployment populated it and every other restaurant was served that menu
 * until the TTL expired. The integration suite caught it as Beta being handed
 * Alpha's categories.
 *
 * A cache key must therefore be built per request, which means `key()` may
 * only be called inside a function.
 */
const cacheKeyOffenders = [];
for (const file of srcFilesForCacheAudit()) {
  const src = fs.readFileSync(file, 'utf8');
  for (const line of src.split('\n')) {
    // A top-level const/let/var assigned directly from key(...) — no leading
    // indentation, so it cannot be inside a function body.
    if (/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*key\(/.test(line)) {
      cacheKeyOffenders.push(`${path.relative(ROOT, file)}: ${line.trim()}`);
    }
  }
}
for (const o of cacheKeyOffenders) console.log(`     ${o}`);
t('no cache key is computed at module scope', cacheKeyOffenders.length === 0,
  'build it inside a function so it picks up the request\'s restaurant');

console.log('\n--- cross-tenant reads are few, and each says why ---');
/*
 * runUnscoped disables tenant filtering. Every call is a place where a bug
 * becomes a leak between customers, so the count is asserted: adding one means
 * changing this number, which shows up in review.
 */
const MAX_UNSCOPED_CALLS = 9;
const srcFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) srcFiles.push(full);
  }
};
walk(path.join(ROOT, 'src'));

const unscopedSites = [];
for (const file of srcFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/runUnscoped\(\s*'([^']+)'/g)) {
    unscopedSites.push(`${path.relative(ROOT, file)}: ${m[1]}`);
  }
}

for (const site of unscopedSites) console.log(`     · ${site}`);
t(`${unscopedSites.length} cross-tenant read(s), at most ${MAX_UNSCOPED_CALLS}`,
  unscopedSites.length <= MAX_UNSCOPED_CALLS,
  'if this is a legitimate new one, raise the cap deliberately');

// A bare runUnscoped() with no reason cannot be audited from a grep.
const unreasoned = srcFiles.filter((f) =>
  /runUnscoped\(\s*(?:\(|async|\)|`)/.test(fs.readFileSync(f, 'utf8')));
t('every runUnscoped states a reason', unreasoned.length === 0,
  unreasoned.map((f) => path.relative(ROOT, f)).join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
