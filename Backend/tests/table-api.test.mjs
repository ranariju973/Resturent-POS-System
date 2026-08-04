/**
 * Table API — Phase 6.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB here, so the transitions are not executed against real
 * documents — in particular the compare-and-swap behaviour under genuine
 * concurrency cannot be proven without a database and two racing clients.
 * That belongs in Phase 12.
 *
 * What runs for real: the schemas, the transition map, the split arithmetic,
 * the auth wall over live HTTP, and a source audit confirming every mutating
 * handler uses an atomic filter rather than read-then-write.
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

import fs from 'node:fs';
import path from 'node:path';
import {
  createTableSchema,
  updateTableSchema,
  listTablesSchema,
  transferSchema,
  splitSchema,
  idParamSchema,
} from '../src/validators/tables.js';
import { TABLE_TRANSITIONS, TABLE_STATUS } from '../src/constants/enums.js';
import { splitMinor, sumMinor, toMinor } from '../src/utils/money.js';

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

// ---------------------------------------------------------------------------
console.log('--- creating a table ---');
const valid = { name: 'T1', seats: 4, zone: 'Indoor' };
t('a valid table is accepted', ok(createTableSchema, valid));
t('name is required', !ok(createTableSchema, { seats: 4, zone: 'Indoor' }));
t('seats is required', !ok(createTableSchema, { name: 'T1', zone: 'Indoor' }));
t('zone is required', !ok(createTableSchema, { name: 'T1', seats: 4 }));
t('status cannot be set on create', !ok(createTableSchema, { ...valid, status: 'occupied' }));
t('currentOrder cannot be injected',
  !ok(createTableSchema, { ...valid, currentOrder: '507f1f77bcf86cd799439011' }));
t('isActive cannot be set', !ok(createTableSchema, { ...valid, isActive: false }));

console.log('\n--- custom seat counts, bounded ---');
t('1 seat accepted', ok(createTableSchema, { ...valid, seats: 1 }));
t('50 seats accepted (a long banquet table)', ok(createTableSchema, { ...valid, seats: 50 }));
t('multipart string "6" coerces', createTableSchema.parse({ ...valid, seats: '6' }).seats === 6);
t('0 seats rejected', !ok(createTableSchema, { ...valid, seats: 0 }));
t('negative seats rejected', !ok(createTableSchema, { ...valid, seats: -4 }));
t('fractional seats rejected', !ok(createTableSchema, { ...valid, seats: 2.5 }));
t('51 seats rejected', !ok(createTableSchema, { ...valid, seats: 51 }));
t('absurd seat count rejected (would render 10k chairs)',
  !ok(createTableSchema, { ...valid, seats: 10000 }));
t('non-numeric seats rejected', !ok(createTableSchema, { ...valid, seats: 'four' }));

console.log('\n--- names and zones reject markup ---');
t('T1 accepted', ok(createTableSchema, { ...valid, name: 'T1' }));
t('P-4 accepted', ok(createTableSchema, { ...valid, name: 'P-4' }));
t('script tag in name rejected',
  !ok(createTableSchema, { ...valid, name: '<script>' }));
t('name with spaces rejected', !ok(createTableSchema, { ...valid, name: 'T 1' }));
t('empty name rejected', !ok(createTableSchema, { ...valid, name: '' }));
t('13-char name rejected', !ok(createTableSchema, { ...valid, name: 'A'.repeat(13) }));
t("zone \"Garden & Patio\" accepted", ok(createTableSchema, { ...valid, zone: 'Garden & Patio' }));
t('zone with markup rejected', !ok(createTableSchema, { ...valid, zone: '<img src=x>' }));
t('31-char zone rejected', !ok(createTableSchema, { ...valid, zone: 'z'.repeat(31) }));

console.log('\n--- update ---');
t('single field is enough', ok(updateTableSchema, { seats: 6 }));
t('empty update rejected', !ok(updateTableSchema, {}));
t('status cannot be changed via update', !ok(updateTableSchema, { status: 'available' }));
t('occupiedAt cannot be forged', !ok(updateTableSchema, { occupiedAt: new Date().toISOString() }));
t('mergedInto cannot be set directly',
  !ok(updateTableSchema, { mergedInto: '507f1f77bcf86cd799439011' }));

console.log('\n--- list filters ---');
t('filter by zone', ok(listTablesSchema, { zone: 'Indoor' }));
t('filter by status', ok(listTablesSchema, { status: 'occupied' }));
t('invalid status rejected', !ok(listTablesSchema, { status: 'dirty' }));
t('unknown filter rejected', !ok(listTablesSchema, { sortBy: 'seats' }));

console.log('\n--- ids ---');
t('valid ObjectId accepted', ok(idParamSchema, { id: '507f1f77bcf86cd799439011' }));
t('short id rejected', !ok(idParamSchema, { id: 'abc' }));
t('operator injection in id rejected', !ok(idParamSchema, { id: { $ne: null } }));
t('transfer requires a target', !ok(transferSchema, {}));
t('transfer target must be an ObjectId', !ok(transferSchema, { targetTableId: 'T2' }));

// ---------------------------------------------------------------------------
console.log('\n--- transition map ---');
t('available -> occupied is legal', TABLE_TRANSITIONS.available.includes(TABLE_STATUS.OCCUPIED));
t('available -> reserved is legal', TABLE_TRANSITIONS.available.includes(TABLE_STATUS.RESERVED));
t('reserved -> occupied is legal (seating the held party)',
  TABLE_TRANSITIONS.reserved.includes(TABLE_STATUS.OCCUPIED));
t('reserved -> available is legal (no-show)',
  TABLE_TRANSITIONS.reserved.includes(TABLE_STATUS.AVAILABLE));
t('occupied -> available is the ONLY exit',
  JSON.stringify(TABLE_TRANSITIONS.occupied) === JSON.stringify([TABLE_STATUS.AVAILABLE]));
t('occupied -> reserved is refused (a seated party cannot become a booking)',
  !TABLE_TRANSITIONS.occupied.includes(TABLE_STATUS.RESERVED));

// ---------------------------------------------------------------------------
console.log('\n--- split-bill arithmetic ---');
t('ways must be at least 2', !ok(splitSchema, { ways: 1 }));
t('ways of 50 accepted', ok(splitSchema, { ways: 50 }));
t('ways of 51 rejected', !ok(splitSchema, { ways: 51 }));
t('fractional ways rejected', !ok(splitSchema, { ways: 2.5 }));
t('string "4" coerces', splitSchema.parse({ ways: '4' }).ways === 4);

// The property that matters: shares always sum back to the exact total.
let conserved = true;
const cases = [];
for (const total of [1000, 1275, 1, 7, 184050, 99999, 100]) {
  for (const ways of [2, 3, 4, 7, 13, 50]) {
    const shares = splitMinor(total, ways);
    const sum = sumMinor(shares);
    if (sum !== total || shares.length !== ways) {
      conserved = false;
      cases.push(`${total}/${ways} -> ${sum}`);
    }
  }
}
t('42 total/ways combinations conserve every minor unit', conserved, cases.join(', '));

{
  // The classic: $10.00 three ways. Naive division gives 3.33 x 3 = 9.99.
  const shares = splitMinor(toMinor(10), 3);
  t('$10 split 3 ways is [3.34, 3.33, 3.33], not 3x3.33',
    JSON.stringify(shares) === JSON.stringify([334, 333, 333]), JSON.stringify(shares));
  t('and it sums back to exactly $10.00', sumMinor(shares) === 1000);
  t('no share differs from another by more than a cent',
    Math.max(...shares) - Math.min(...shares) <= 1);
}

// ---------------------------------------------------------------------------
console.log('\n--- every table route is behind authentication (live HTTP) ---');
const ID = '507f1f77bcf86cd799439011';
const ROUTES = [
  ['GET', '/api/tables'],
  ['GET', '/api/tables/zones'],
  ['GET', `/api/tables/${ID}`],
  ['POST', '/api/tables'],
  ['PUT', `/api/tables/${ID}`],
  ['DELETE', `/api/tables/${ID}`],
  ['PATCH', `/api/tables/${ID}/seat`],
  ['PATCH', `/api/tables/${ID}/reserve`],
  ['PATCH', `/api/tables/${ID}/release`],
  ['POST', `/api/tables/${ID}/transfer`],
  ['POST', `/api/tables/${ID}/merge`],
  ['POST', `/api/tables/${ID}/unmerge`],
  ['POST', `/api/tables/${ID}/split`],
];

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  let unauthorised = 0;
  for (const [method, url] of ROUTES) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
    });
    if (res.status === 401) unauthorised += 1;
    else console.log(`     ${method} ${url} -> ${res.status} (expected 401)`);
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller`, unauthorised === ROUTES.length,
    `${unauthorised}/${ROUTES.length}`);

  const forged = await fetch(`${base}/api/tables`, {
    headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.' },
  });
  t('alg:none token claiming admin is rejected', forged.status === 401);

  // /zones must not be swallowed by /:id — if it were, this would be a 400
  // from id validation rather than a 401 from the auth wall.
  const zones = await fetch(`${base}/api/tables/zones`);
  t('/zones is matched as its own route, not as an id', zones.status === 401);
} finally {
  await new Promise((r) => server.close(r));
}

// ---------------------------------------------------------------------------
console.log('\n--- concurrency: transitions are compare-and-swap, not read-then-write ---');
const ROOT = path.resolve(import.meta.dirname, '..');
const ctl = fs.readFileSync(path.join(ROOT, 'src/controllers/tableController.js'), 'utf8');

t('seat claims the table atomically',
  /seatTable[\s\S]{0,400}findOneAndUpdate\(\s*\{[\s\S]{0,200}status:/.test(ctl));
t('seat filters on status, so a taken table cannot be re-seated',
  /seatTable[\s\S]{0,400}\$in: \[TABLE_STATUS\.AVAILABLE, TABLE_STATUS\.RESERVED\]/.test(ctl));
t('a lost race becomes 409, not a silent overwrite',
  /has just been taken/.test(ctl));
t('reserve is atomic too',
  /reserveTable[\s\S]{0,300}findOneAndUpdate/.test(ctl));
t('transfer claims the DESTINATION before releasing the source',
  ctl.indexOf('Claim the destination') < ctl.indexOf('source.release()'));
t('transfer refuses a same-table move',
  /Source and destination are the same table/.test(ctl));
t('merge refuses when both tables hold bills',
  /Both tables have open bills/.test(ctl));
t('merge refuses to build chains',
  /itself merged into another/.test(ctl));

console.log('\n--- destructive actions are guarded ---');
t('delete refuses with an open order', /Cannot delete a table with an open order/.test(ctl));
t('delete refuses while occupied', /Cannot delete an occupied table/.test(ctl));
t('delete refuses if other tables merge into it', /other tables are merged into/.test(ctl));
t('release refuses with an open bill', /Settle or void the open bill/.test(ctl));
t('reconfiguring an occupied table is refused',
  /Cannot reconfigure a table while it is occupied/.test(ctl));
t('delete is soft (order history keeps resolving)', /table\.isActive = false/.test(ctl));
t('split persists nothing', !/splitBill[\s\S]{0,900}\.save\(\)/.test(ctl));

console.log('\n--- route wiring ---');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes/tables.js'), 'utf8');
const declared = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
t(`${declared.length} routes declared`, declared.length === 13, `${declared.length}`);
t('requireAuth applied router-wide', /router\.use\(requireAuth\(\)\)/.test(routes));

const blocks = routes.split(/router\.(?=get|post|put|patch|delete)/).slice(1);
const unguarded = blocks.filter((b) => !b.slice(0, b.indexOf('\n);')).includes('requirePermission'));
t('every route names a permission', unguarded.length === 0);

// Compare positions in the PARSED declaration list, not raw string offsets —
// a comment mentioning '/:id' would otherwise be matched first and make this
// assertion lie in both directions.
{
  const paths = declared.map((m) => `${m[1]} ${m[2]}`);
  const zonesAt = paths.indexOf('get /zones');
  const idAt = paths.indexOf('get /:id');
  t('GET /zones is declared before GET /:id (specific path wins)',
    zonesAt !== -1 && idAt !== -1 && zonesAt < idAt, `zones@${zonesAt}, :id@${idAt}`);
}
t('create/edit/delete are admin-only permissions',
  /TABLE_CREATE/.test(routes) && /TABLE_EDIT/.test(routes) && /TABLE_DELETE/.test(routes));
t('seating actions use TABLE_MANAGE_SEATING',
  (routes.match(/TABLE_MANAGE_SEATING/g) ?? []).length === 7);
t('reads use TABLE_VIEW', (routes.match(/TABLE_VIEW/g) ?? []).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
