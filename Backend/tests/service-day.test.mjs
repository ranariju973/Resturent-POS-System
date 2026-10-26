import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { todayIso, dayStart, dayEnd, monthStart, serviceWindow, nextServiceReset } from '../src/utils/date.js';
import { createOrderSchema } from '../src/validators/orders.js';
import { recentOrdersSchema } from '../src/validators/reports.js';
import { Ticket } from '../src/models/Ticket.js';
import { safeRequestPath, redactText } from '../src/utils/logRedaction.js';
import { runInTenant } from '../src/utils/tenantContext.js';
import { emitEvent, subscribeAll, EVENTS, listenerCount } from '../src/utils/eventBus.js';
import { remember, delPrefix, clearAll, size, set } from '../src/utils/cache.js';

let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }
const before = new Date('2026-10-26T03:59:59+05:30');
const boundary = new Date('2026-10-26T04:00:00+05:30');
test('before 4 AM retains the previous two service dates', () => {
  assert.equal(serviceWindow(before).recentSince.toISOString(), '2026-10-23T22:30:00.000Z');
  assert.equal(nextServiceReset(before).toISOString(), boundary.toISOString());
});
test('exactly 4 AM starts the next service and rotates recent history', () => {
  assert.equal(serviceWindow(boundary).recentSince.toISOString(), '2026-10-24T22:30:00.000Z');
  assert.equal(nextServiceReset(boundary).toISOString(), '2026-10-26T22:30:00.000Z');
});
test('calendar totals continue through midnight independently of service reset', () => {
  assert.equal(todayIso(before), '2026-10-26');
  assert.equal(dayStart(todayIso(before)).toISOString(), '2026-10-25T18:30:00.000Z');
});
test('year and leap-month boundaries', () => {
  assert.equal(todayIso(new Date('2026-12-31T18:30:00Z')), '2027-01-01');
  assert.equal(monthStart('2027-01', -1).toISOString(), '2026-11-30T18:30:00.000Z');
  assert.equal(dayEnd('2028-02-29').toISOString(), '2028-02-29T18:30:00.000Z');
});
test('the host timezone cannot change the reset', () => {
  const script = "import { serviceWindow } from './src/utils/date.js'; process.stdout.write(serviceWindow(new Date('2026-10-26T04:00:00+05:30')).nextResetAt.toISOString());";
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { env: { ...process.env, TZ }, encoding: 'utf8' }), '2026-10-26T22:30:00.000Z');
  }
});
test('advancing or recalling a ticket never extends expiry', () => {
  const ticket = new Ticket({ placedAt: before });
  const expiry = ticket.expiresAt.getTime();
  ticket.advance(); ticket.advance(); ticket.recall();
  assert.equal(ticket.expiresAt.getTime(), expiry);
});
test('TTL deletes only tickets and uses an absolute date', () => {
  assert(Ticket.schema.indexes().some(([keys, options]) => keys.expiresAt === 1
    && Object.keys(keys).length === 1 && options.expireAfterSeconds === 0));
});
const first = '507f1f77bcf86cd799439011';
const second = '507f1f77bcf86cd799439012';
const bill = { type: 'dine-in', tableIds: [first, second], items: [{ menuItemId: first, qty: 1 }] };
test('multiple tables and legacy table requests validate', () => {
  assert(createOrderSchema.safeParse(bill).success);
  assert(createOrderSchema.safeParse({ ...bill, tableIds: undefined, tableId: first }).success);
});
test('duplicate, mixed, empty and non-dine-in table selections are rejected', () => {
  for (const patch of [{ tableId: first }, { tableIds: [] }, { tableIds: [first, first] },
    { tableIds: [first, first.toUpperCase()] }, { type: 'takeaway' }]) {
    assert.equal(createOrderSchema.safeParse({ ...bill, ...patch }).success, false);
  }
});
test('recent pagination cannot widen scope or inject query operators', () => {
  assert(recentOrdersSchema.safeParse({}).success);
  assert(!recentOrdersSchema.safeParse({ from: '2000-01-01' }).success);
  assert(!recentOrdersSchema.safeParse({ cursor: { $gt: '' } }).success);
});
test('URL logs exclude invoice credentials and query strings', () => {
  assert.equal(safeRequestPath({ originalUrl: '/api/kitchen/stream?token=private' }), '/api/kitchen/stream');
  assert.equal(safeRequestPath({ originalUrl: '/api/invoice/INV-private?customer=secret' }), '/api/invoice/[REDACTED]');
  const text = redactText('mongodb+srv://user:password@host/db token=abc known-secret-value', ['known-secret-value']);
  assert(!text.includes('user:password')); assert(!text.includes('token=abc')); assert(!text.includes('known-secret-value'));
});
test('kitchen events stay in the subscriber restaurant', () => {
  const a = [], b = [];
  const start = listenerCount();
  const offA = subscribeAll((event) => a.push(event), first);
  const offB = subscribeAll((event) => b.push(event), second);
  runInTenant(first, () => emitEvent(EVENTS.TICKET_CREATED, { orderId: 'a' }));
  runInTenant(second, () => emitEvent(EVENTS.TICKET_CREATED, { orderId: 'b' }));
  assert.equal(a.length, 1); assert.equal(a[0].orderId, 'a'); assert.equal(a[0].tenantId, undefined);
  assert.equal(b.length, 1); assert.equal(b[0].orderId, 'b');
  offA(); offB(); assert.equal(listenerCount(), start);
});
clearAll();
let computations = 0;
await Promise.all(Array.from({ length: 10 }, () => remember('concurrent', 1000, async () => {
  computations++; return 42;
})));
test('concurrent cache misses share one computation', () => assert.equal(computations, 1));
await delPrefix('concurrent');
for (let n = 0; n < 2100; n++) await set(`bounded:${n}`, n, 1000);
test('date-keyed caches have a bounded size', () => assert(size() <= 2048));
clearAll();
console.log(`\n${passed} passed, 0 failed`);
