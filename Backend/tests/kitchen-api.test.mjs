/**
 * Kitchen board — Phase 8.
 *
 * ── Coverage boundary ──────────────────────────────────────────────────────
 * No MongoDB, so no ticket is actually advanced. But two things here DO run
 * for real and are worth more than usual:
 *
 *   • the event bus, exercised end to end in-process (it needs no database)
 *   • the stream-token round trip, using the real jwt module — minting,
 *     verifying, and confirming the three token types cannot substitute for
 *     one another
 *
 * The SSE connection itself is not tested: it is a long-lived response, and
 * asserting on heartbeats and proxy behaviour needs an integration harness.
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
import { listTicketsSchema, boardSchema, emptyBodySchema } from '../src/validators/kitchen.js';
import { NEXT_TICKET_STATUS, TICKET_STATUS, TICKET_STATUS_VALUES } from '../src/constants/enums.js';
import { emitEvent, subscribeAll, listenerCount, EVENTS } from '../src/utils/eventBus.js';
import {
  signStreamToken,
  verifyStreamToken,
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  STREAM_TOKEN_TTL_SECONDS,
} from '../src/utils/jwt.js';

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
console.log('--- advance takes no body, so no target can be named ---');
t('an empty body is accepted', ok(emptyBodySchema, {}));
t('REJECTS {status:"served"} — the skip-to-the-end attempt',
  !ok(emptyBodySchema, { status: 'served' }));
t('REJECTS {status:"ready"}', !ok(emptyBodySchema, { status: 'ready' }));
t('REJECTS a "to" field', !ok(emptyBodySchema, { to: 'preparing' }));
t('REJECTS a forged readyAt', !ok(emptyBodySchema, { readyAt: '2020-01-01' }));
t('REJECTS statusHistory tampering', !ok(emptyBodySchema, { statusHistory: [] }));
t('REJECTS a "by" attribution', !ok(emptyBodySchema, { by: '507f1f77bcf86cd799439011' }));

console.log('\n--- the destination is derived, and only ever one step ---');
{
  let s = TICKET_STATUS.PENDING;
  const chain = [s];
  let guard = 0;
  while (NEXT_TICKET_STATUS[s] && guard++ < 10) {
    s = NEXT_TICKET_STATUS[s];
    chain.push(s);
  }
  t(`the whole chain is ${chain.join(' -> ')}`,
    chain.join() === 'pending,preparing,ready,served');
  t('pending cannot reach served in one step',
    NEXT_TICKET_STATUS[TICKET_STATUS.PENDING] !== TICKET_STATUS.SERVED);
  t('served is terminal', NEXT_TICKET_STATUS[TICKET_STATUS.SERVED] === null);
  t('no status advances to itself',
    TICKET_STATUS_VALUES.every((v) => NEXT_TICKET_STATUS[v] !== v));
}

console.log('\n--- board filters are bounded ---');
t('servedWithinMinutes defaults to 60', boardSchema.parse({}).servedWithinMinutes === 60);
t('12 hours is the cap', ok(boardSchema, { servedWithinMinutes: 720 }));
t('13 hours rejected (the board is not a report)',
  !ok(boardSchema, { servedWithinMinutes: 721 }));
t('negative window rejected', !ok(boardSchema, { servedWithinMinutes: -5 }));
t('unknown board filter rejected', !ok(boardSchema, { sortBy: 'urgency' }));
t('ticket limit defaults to 100', listTicketsSchema.parse({}).limit === 100);
t('limit above 200 rejected', !ok(listTicketsSchema, { limit: 1000 }));
t('bad status rejected', !ok(listTicketsSchema, { status: 'burnt' }));
t('unknown ticket filter rejected', !ok(listTicketsSchema, { chef: 'marco' }));

// ---------------------------------------------------------------------------
console.log('\n--- event bus (running for real, no database needed) ---');
{
  const before = listenerCount();
  const received = [];
  const unsubscribe = subscribeAll((payload) => received.push(payload));

  t('subscribing registers a listener per event type', listenerCount() > before);

  emitEvent(EVENTS.TICKET_ADVANCED, { ticket: { id: 'a', no: 41 } });
  emitEvent(EVENTS.TICKET_CREATED, { ticket: { id: 'b', no: 42 } });
  emitEvent(EVENTS.ORDER_VOIDED, { orderId: 'c', orderNo: 43 });

  t('all three events were delivered', received.length === 3, `got ${received.length}`);
  t('each carries its own event name',
    received.map((r) => r.event).join() === 'ticket:advanced,ticket:created,order:voided');
  t('each is timestamped', received.every((r) => typeof r.at === 'string'));
  t('the payload survives intact', received[0].ticket.no === 41);

  unsubscribe();
  t('unsubscribing removes every listener', listenerCount() === before);

  emitEvent(EVENTS.TICKET_ADVANCED, { ticket: { id: 'd' } });
  t('no delivery after unsubscribe', received.length === 3);
}

{
  // Several boards on the line, one till, the manager's tablet.
  const seen = [0, 0, 0, 0];
  const offs = seen.map((_, i) => subscribeAll(() => { seen[i] += 1; }));
  emitEvent(EVENTS.TICKET_ADVANCED, { ticket: { id: 'x' } });
  t('one event fans out to all 4 subscribers', seen.every((n) => n === 1), seen.join(','));
  offs.forEach((off) => off());
}

{
  // A crashing board must not take the others down with it.
  const survived = [];
  const offBad = subscribeAll(() => { throw new Error('this subscriber is broken'); });
  const offGood = subscribeAll(() => survived.push(1));
  let threwOut = false;
  try {
    emitEvent(EVENTS.TICKET_ADVANCED, { ticket: { id: 'y' } });
  } catch {
    threwOut = true;
  }
  t('a throwing subscriber does not propagate out of emitEvent', !threwOut);
  offBad();
  offGood();
}

// ---------------------------------------------------------------------------
console.log('\n--- stream tokens (real jwt module) ---');
const fakeUser = { id: '507f1f77bcf86cd799439011', role: 'kitchen_staff', tokenVersion: 0 };
const streamToken = signStreamToken(fakeUser);

{
  const payload = verifyStreamToken(streamToken);
  t('a stream token verifies', payload.sub === fakeUser.id);
  t("its type claim is 'stream'", payload.typ === 'stream');
  t(`it expires in ${STREAM_TOKEN_TTL_SECONDS}s`,
    payload.exp - payload.iat === STREAM_TOKEN_TTL_SECONDS);
  t('it carries no role (authorisation is re-read from the database)',
    payload.role === undefined);
}

console.log('\n--- the three token types cannot substitute for one another ---');
const accessToken = signAccessToken(fakeUser);
const { token: refreshToken } = signRefreshToken(fakeUser, { family: '507f1f77bcf86cd799439011' });

const rejects = (fn, token) => {
  try {
    fn(token);
    return false;
  } catch {
    return true;
  }
};

t('a STREAM token is rejected as an access token', rejects(verifyAccessToken, streamToken));
t('an ACCESS token is rejected as a stream token', rejects(verifyStreamToken, accessToken));
t('a REFRESH token is rejected as a stream token', rejects(verifyStreamToken, refreshToken));
t('a REFRESH token is rejected as an access token', rejects(verifyAccessToken, refreshToken));
t('a STREAM token is rejected as a refresh token', rejects(verifyRefreshToken, streamToken));
t('an ACCESS token is rejected as a refresh token', rejects(verifyRefreshToken, accessToken));
t('garbage is rejected', rejects(verifyStreamToken, 'not.a.token'));
t('alg:none forgery is rejected',
  rejects(verifyStreamToken, 'eyJhbGciOiJub25lIn0.eyJ0eXAiOiJzdHJlYW0ifQ.'));

// ---------------------------------------------------------------------------
console.log('\n--- auth wall (live HTTP) ---');
const ID = '507f1f77bcf86cd799439011';
const ROUTES = [
  ['GET', '/api/kitchen/board'],
  ['GET', '/api/kitchen/tickets'],
  ['GET', `/api/kitchen/tickets/${ID}`],
  ['PATCH', `/api/kitchen/tickets/${ID}/advance`],
  ['PATCH', `/api/kitchen/tickets/${ID}/recall`],
  ['POST', '/api/kitchen/stream-token'],
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
      body: ['POST', 'PATCH'].includes(method) ? '{}' : undefined,
    });
    if (res.status === 401) unauthorised += 1;
    else console.log(`     ${method} ${url} -> ${res.status} (expected 401)`);
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller`, unauthorised === ROUTES.length,
    `${unauthorised}/${ROUTES.length}`);

  console.log('\n--- the stream endpoint ---');
  const noToken = await fetch(`${base}/api/kitchen/stream`);
  t('no token -> 401', noToken.status === 401, `got ${noToken.status}`);

  const badToken = await fetch(`${base}/api/kitchen/stream?token=garbage`);
  t('garbage token -> 401', badToken.status === 401);

  // The important one: a full-power access token must not open the stream.
  const wrongType = await fetch(`${base}/api/kitchen/stream?token=${accessToken}`);
  t('an ACCESS token in the query string is refused', wrongType.status === 401,
    `got ${wrongType.status}`);

  const forged = await fetch(
    `${base}/api/kitchen/stream?token=eyJhbGciOiJub25lIn0.eyJ0eXAiOiJzdHJlYW0ifQ.`,
  );
  t('alg:none forgery is refused', forged.status === 401);
} finally {
  await new Promise((r) => server.close(r));
}

// ---------------------------------------------------------------------------
console.log('\n--- source audit ---');
const ROOT = path.resolve(import.meta.dirname, '..');
const ctl = fs.readFileSync(path.join(ROOT, 'src/controllers/kitchenController.js'), 'utf8');
const code = ctl.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes/kitchen.js'), 'utf8');
const ticket = fs.readFileSync(path.join(ROOT, 'src/models/Ticket.js'), 'utf8');

t('the next status is read from the map, not the request',
  /NEXT_TICKET_STATUS\[current\.status\]/.test(code));
t('req.body is never consulted for a status', !/req\.body[\s\S]{0,30}status/.test(code));
t('a double-tap is guarded by the stored status',
  /findOneAndUpdate\(\s*\n?\s*\{ _id: current\._id, status: current\.status \}/.test(code));
t('a lost race is a 409, not a skipped stage', /just moved by someone else/.test(ctl));
t('readyAt is stamped on the first transition to ready',
  /next === TICKET_STATUS\.READY && !current\.readyAt/.test(code));

console.log('\n--- recall is separated from advance ---');
t('recall is admin-only at the route', /KITCHEN_RECALL/.test(routes));
t('advance is open to all three roles', /KITCHEN_ADVANCE_STATUS/.test(routes));
t('history stays append-only (recall pushes, never edits)',
  /\$push: \{ statusHistory[\s\S]{0,80}recalled: true/.test(code));
t('a recalled entry is flagged as such', /recalled: \{ type: Boolean/.test(ticket));
t('recall clears a stale readyAt', /readyAt: null/.test(code));
t('recall refuses at the first stage', /already at the first stage/.test(ctl));

console.log('\n--- the kitchen sees no prices ---');
t('only name, qty and note are populated from the order',
  /ORDER_FIELDS = 'items\._id items\.nameSnapshot items\.qty items\.note'/.test(ctl));
t('no price field reaches the board payload',
  !/priceMinorAtSale|totalMinor|priceMinor/.test(code));

console.log('\n--- stream endpoint hygiene ---');
t('the stream re-loads the user from the database', /User\.findById\(payload\.sub\)/.test(code));
t('it re-checks kitchen:view rather than trusting the token',
  /hasPermission\(user\.role, PERMISSIONS\.KITCHEN_VIEW\)/.test(code));
t('a deactivated account cannot hold a stream open', /!user\.isActive/.test(code));
t('a stale tokenVersion is rejected', /payload\.tv[\s\S]{0,40}user\.tokenVersion/.test(code));
t('there is a heartbeat, so proxies do not silently reap the connection',
  /: ping/.test(ctl));
t('buffering is disabled for reverse proxies', /X-Accel-Buffering/.test(ctl));
t('listeners are removed when the client disconnects',
  /req\.on\('close', cleanup\)/.test(code) && /unsubscribe\(\)/.test(code));
{
  // Compare on COMMENT-STRIPPED source. Twice now a docblock mentioning the
  // very line being searched for has made an ordering assertion lie, so the
  // prose and the code are separated before either is measured.
  const routeCode = routes.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const streamAt = routeCode.indexOf("router.get('/stream'");
  const authAt = routeCode.indexOf('router.use(requireAuth())');
  t('the stream route is declared before requireAuth (it authenticates itself)',
    streamAt !== -1 && authAt !== -1 && streamAt < authAt, `stream@${streamAt}, auth@${authAt}`);
}

console.log('\n--- order creation announces to the board ---');
const orderCtl = fs.readFileSync(path.join(ROOT, 'src/controllers/orderController.js'), 'utf8');
t('a new ticket is announced', /announceNewTicket\(result\.ticket, result\.order\)/.test(orderCtl));
t('...only AFTER the transaction commits, so a rollback is never announced',
  orderCtl.indexOf('await withTransaction') < orderCtl.indexOf('announceNewTicket(result'));
t('a void tells the boards to drop the ticket', /EVENTS\.ORDER_VOIDED/.test(orderCtl));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
