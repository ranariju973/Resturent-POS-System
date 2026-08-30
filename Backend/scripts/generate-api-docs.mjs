/**
 * Generates API.md from the route files.
 *
 * Written as a generator rather than a hand-maintained document because a
 * hand-maintained API reference is wrong within a month, and a wrong reference
 * is worse than none — it gets trusted.
 *
 * Run with: npm run docs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ROUTES = path.join(ROOT, 'src/routes');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

/**
 * Where each router is mounted — read from app.js, not restated here.
 *
 * This used to be a hand-written map, which is exactly the failure mode the
 * header of this file warns about: it fell behind the application and quietly
 * omitted eight route files, so a third of the API was missing from its own
 * reference and nothing said so. Reading the mounts from the source that
 * actually performs them means a new router appears in the docs the moment it
 * is served.
 */
const appSrc = strip(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
const MOUNTS = {};
for (const m of appSrc.matchAll(/app\.use\(\s*'([^']+)',\s*(\w+)\)/g)) {
  const [, mount, ident] = m;
  // `import xRoutes from './src/routes/x.js'` — the file behind the identifier.
  const file = appSrc.match(
    new RegExp(`import ${ident} from '[^']*routes/([\\w.-]+)'`),
  )?.[1];
  if (file) MOUNTS[file] = mount;
}

/**
 * Every route in one file, each with the middleware that belongs to it.
 *
 * Sliced on declaration boundaries rather than matched as whole declarations.
 * A non-greedy body pattern has no idea where a route STOPS, so a single-line
 * route sitting above a multi-line one swallowed everything between them and
 * the routes in the middle vanished — silently, which is the worst way for a
 * generated reference to be wrong.
 */
function parseRoutes(code) {
  const decl = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g;
  const found = [];
  let m;
  while ((m = decl.exec(code)) !== null) {
    found.push({ method: m[1].toUpperCase(), path: m[2], at: m.index, from: decl.lastIndex });
  }
  return found.map((r, i) => ({
    ...r,
    /*
     * Router-wide guards are removed before the INLINE check.
     *
     * A route's block runs to the next declaration, so any `router.use()`
     * sitting between them falls inside it — and kitchen.js puts
     * `router.use(requireAuth())` immediately after GET /stream precisely
     * because that route must NOT be covered by it. Testing the raw block
     * credited the route with the very guard it was declared in front of.
     */
    body: code
      .slice(r.from, found[i + 1]?.at ?? code.length)
      .replace(/router\.use\([\s\S]*?\);/g, ''),
  }));
}

const rows = [];
for (const file of Object.keys(MOUNTS)) {
  const full = path.join(ROUTES, file);
  if (!fs.existsSync(full)) continue;
  const code = strip(fs.readFileSync(full, 'utf8'));

  /*
   * WHERE the router-wide guards begin, not merely whether they exist.
   *
   * `router.use()` covers only what is declared after it, and kitchen.js
   * depends on that: GET /stream sits above `router.use(requireAuth())`
   * because EventSource cannot send an Authorization header, so the handler
   * verifies a single-purpose token itself. A file-wide boolean documented
   * that route as requiring a bearer token — the exact opposite of the truth,
   * in the table people read to find out which doors are open.
   */
  const authAt = code.search(/router\.use\(requireAuth\(\)\)/);
  const routerAuthFrom = authAt === -1 ? Infinity : authAt;
  const permAt = code.search(/router\.use\(requirePermission\(/);
  const routerPermFrom = permAt === -1 ? Infinity : permAt;
  const routerPerm = code.match(/router\.use\(requirePermission\(PERMISSIONS\.(\w+)\)\)/)?.[1];

  for (const { method, path: routePath, body, at } of parseRoutes(code)) {
    const perm =
      body.match(/requirePermission\(PERMISSIONS\.(\w+)\)/)?.[1]
      ?? (body.includes('requireAnyPermission')
        ? 'either dashboard grant'
        : (at > routerPermFrom ? routerPerm : undefined));

    const mount = MOUNTS[file];
    const fullPath = routePath === '/' ? mount : `${mount}${routePath}`;

    rows.push({
      file,
      method,
      path: fullPath,
      auth: at > routerAuthFrom || /requireAuth\(\)/.test(body),
      permission: perm ?? '—',
      validated: /validate\(\{/.test(body),
    });
  }
}

/**
 * Human titles, in the order the reference reads best.
 *
 * A file with no entry here still appears — under a title derived from its
 * name — because a route missing from the docs is worse than one filed under
 * an ugly heading.
 */
const GROUPS = {
  'health.js': 'Health',
  'auth.js': 'Authentication',
  'tenants.js': 'Restaurant',
  'terminal.js': 'Terminal',
  'devices.js': 'Terminal management',
  'menu.js': 'Menu',
  'tables.js': 'Tables',
  'orders.js': 'POS Billing',
  'kitchen.js': 'Kitchen',
  'customers.js': 'Customers',
  'employees.js': 'Employees',
  'attendance.js': 'Attendance',
  'payroll.js': 'Payroll',
  'dashboard.js': 'Dashboard',
  'reports.js': 'Reports',
  'settings.js': 'Settings',
  'invoice.js': 'Public invoice',
  'audit.js': 'Audit log',
};

// Anything mounted but not titled above, so nothing can drop out silently.
for (const file of Object.keys(MOUNTS)) {
  if (!GROUPS[file]) GROUPS[file] = file.replace(/\.js$/, '');
}

let out = `# API reference

**Generated** by \`npm run docs\` from \`src/routes/\`. Do not edit by hand — a
hand-maintained reference is wrong within a month, and a wrong reference is
worse than none because it gets trusted.

${rows.length} routes. Every response uses the envelope
\`{ success, data }\` or \`{ success: false, error: { message, code?, details? }, requestId }\`.

Permission names map to roles in \`src/constants/permissions.js\`:

| Role | Holds |
| --- | --- |
| \`admin\` | every permission |
| \`cashier\` | dashboard (limited), POS, menu view + stock toggle, tables (seating), kitchen, customers |
| \`kitchen_staff\` | kitchen view + advance, menu view + stock toggle — 4 permissions, nothing else |

`;

for (const [file, title] of Object.entries(GROUPS)) {
  const group = rows.filter((r) => r.file === file);
  if (!group.length) continue;

  out += `\n## ${title}\n\n| Method | Path | Auth | Permission | Validated |\n| --- | --- | --- | --- | --- |\n`;
  for (const r of group) {
    out += `| ${r.method} | \`${r.path}\` | ${r.auth ? '✅' : '—'} | ${r.permission === '—' ? '—' : `\`${r.permission}\``} | ${r.validated ? '✅' : '—'} |\n`;
  }
}

/**
 * The open doors, derived rather than listed.
 *
 * This table used to be typed by hand, and had drifted into naming a route
 * that no longer existed while claiming "these five" above six rows. The set
 * of unauthenticated routes is the single most security-relevant fact in this
 * document, so it is the last thing that should be maintained by memory.
 *
 * The reasons stay written by hand — a machine cannot say WHY a door is open —
 * but a route with no reason is reported as such instead of being omitted.
 */
const WHY_OPEN = {
  'GET /api/health': 'Liveness probe. Reveals nothing about the business',
  'POST /api/auth/google':
    'Cannot require a session to create one. The Google ID token is verified against '
    + "Google's published keys, plus an email_verified check. Rate-limited to 5 failures/15min",
  'POST /api/auth/register':
    'Same. Bounded by a signup limiter that counts successes too, because on a signup '
    + 'endpoint the success is what costs anything',
  'POST /api/auth/login/password':
    'Same, plus progressive account lockout. Every failure returns one indistinguishable '
    + 'message after an equal-time bcrypt burn',
  'POST /api/auth/login/staff':
    "Same. The restaurant is resolved from the terminal's device cookie BEFORE the PIN is "
    + 'matched, so a PIN is only ever compared within one restaurant',
  'POST /api/auth/refresh': 'Authenticated by the httpOnly refresh cookie',
  'POST /api/auth/logout': 'An expired token must not prevent ending a session',
  'GET /api/auth/terminal':
    'The login screen must name the restaurant before anyone has a session. Reads only the '
    + 'device cookie and returns two names',
  'GET /api/kitchen/stream':
    'EventSource cannot set headers. Verifies a 60-second single-purpose token in-handler '
    + 'and re-checks `kitchen:view` against the database',
  'GET /api/invoice/:slug':
    'A customer opening a receipt link has no session and never will. Authenticated by a '
    + '192-bit token in the URL, hashed at rest',
};

const open = rows.filter((r) => !r.auth);

out += `
## Unauthenticated routes

${open.length} of ${rows.length}, each deliberate. Everything else requires a bearer token.

| Route | Why |
| --- | --- |
`;

for (const r of open) {
  const key = `${r.method} ${r.path}`;
  out += `| \`${key}\` | ${WHY_OPEN[key] ?? '**No reason recorded — add one to scripts/generate-api-docs.mjs**'} |\n`;
}

out += `
## Money

Every monetary value is an **integer in minor units** — \`425\` means 4.25.
Responses include both: \`totalMinor: 1275\` alongside \`total: 12.75\`. Requests
accept major units (\`price: 4.25\`) and convert at the boundary.

The order endpoints accept **no price field at all** — the client sends item ids
and quantities, and the server prices from the database.
`;

fs.writeFileSync(path.join(ROOT, 'API.md'), out);
console.log(`Wrote API.md — ${rows.length} routes across ${Object.keys(GROUPS).length} groups`);
