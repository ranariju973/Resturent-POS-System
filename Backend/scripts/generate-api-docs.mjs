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

const MOUNTS = {
  'health.js': '/api',
  'auth.js': '/api/auth',
  'menu.js': '/api/menu',
  'tables.js': '/api/tables',
  'orders.js': '/api/orders',
  'kitchen.js': '/api/kitchen',
  'customers.js': '/api/customers',
  'dashboard.js': '/api/dashboard',
  'reports.js': '/api/reports',
  'audit.js': '/api/audit-logs',
};

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

const rows = [];
for (const file of Object.keys(MOUNTS)) {
  const full = path.join(ROUTES, file);
  if (!fs.existsSync(full)) continue;
  const code = strip(fs.readFileSync(full, 'utf8'));

  const routerAuth = /router\.use\(requireAuth\(\)\)/.test(code);
  const routerPerm = code.match(/router\.use\(requirePermission\(PERMISSIONS\.(\w+)\)\)/)?.[1];

  // Two shapes: a multi-line middleware chain, and a single-line declaration.
  // Matching only the first undercounted by 12 routes — including every route
  // in audit.js. Same gap the Phase 11 coverage sweep hit.
  const patterns = [
    /router\.(get|post|put|patch|delete)\(\s*'([^']+)'([\s\S]*?)\n\}?\);/g,
    /router\.(get|post|put|patch|delete)\(\s*'([^']+)',([^\n]*)\);/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
  let m;
  while ((m = re.exec(code)) !== null) {
    const [, method, routePath, body] = m;
    const dedupe = `${method}:${routePath}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const perm =
      body.match(/requirePermission\(PERMISSIONS\.(\w+)\)/)?.[1] ??
      (body.includes('requireAnyPermission') ? 'either dashboard grant' : routerPerm);

    const mount = MOUNTS[file];
    const fullPath = routePath === '/' ? mount : `${mount}${routePath}`;

    rows.push({
      file,
      method: method.toUpperCase(),
      path: fullPath,
      auth: routerAuth || /requireAuth\(\)/.test(body),
      permission: perm ?? '—',
      validated: /validate\(\{/.test(body),
    });
  }
  }
}

const GROUPS = {
  'health.js': 'Health',
  'auth.js': 'Authentication',
  'menu.js': 'Menu',
  'tables.js': 'Tables',
  'orders.js': 'POS Billing',
  'kitchen.js': 'Kitchen',
  'customers.js': 'Customers',
  'dashboard.js': 'Dashboard',
  'reports.js': 'Reports',
  'audit.js': 'Audit log',
};

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

out += `
## Unauthenticated routes

These five are deliberate. Everything else requires a bearer token.

| Route | Why |
| --- | --- |
| \`GET /api/health\` | Liveness probe. Reveals nothing about the business |
| \`POST /api/auth/login/admin\` | Cannot require a session to create one. Rate-limited to 5 failures/15min |
| \`POST /api/auth/login/staff\` | Same, plus progressive account lockout |
| \`POST /api/auth/refresh\` | Authenticated by the httpOnly refresh cookie |
| \`POST /api/auth/logout\` | An expired token must not prevent ending a session |
| \`GET /api/kitchen/stream\` | EventSource cannot set headers. Verifies a 60-second single-purpose token in-handler and re-checks \`kitchen:view\` against the database |

## Money

Every monetary value is an **integer in minor units** — \`425\` means 4.25.
Responses include both: \`totalMinor: 1275\` alongside \`total: 12.75\`. Requests
accept major units (\`price: 4.25\`) and convert at the boundary.

The order endpoints accept **no price field at all** — the client sends item ids
and quantities, and the server prices from the database.
`;

fs.writeFileSync(path.join(ROOT, 'API.md'), out);
console.log(`Wrote API.md — ${rows.length} routes across ${Object.keys(GROUPS).length} groups`);
