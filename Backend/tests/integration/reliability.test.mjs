import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect, wipe, disconnect, createReporter, toTestUri } from './setup.mjs';
import mongoose from 'mongoose';
import { runInTenant } from '../../src/utils/tenantContext.js';
import { serviceWindow, nextServiceReset, dayStart, todayIso } from '../../src/utils/date.js';
import { signAccessToken, signStreamToken, signRefreshToken, REFRESH_COOKIE } from '../../src/utils/jwt.js';
import { clearAll } from '../../src/utils/cache.js';
import { emitEvent, EVENTS, listenerCount } from '../../src/utils/eventBus.js';
import '../../src/models/index.js';

process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });
process.on('unhandledRejection', (error) => { console.error(error); process.exit(1); });
const { t, finish } = createReporter();
await connect();
mongoose.set('sanitizeFilter', true);
await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
await wipe();
const { Tenant, User, Category, MenuItem, Table, Order, Ticket, Customer, AuditLog, RefreshToken } = mongoose.models;
const { default: app } = await import('../../app.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (token, method, path, body) => {
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const json = response.status === 204 ? null : await response.json();
  return { status: response.status, data: json?.data, error: json?.error };
};
async function fixture(slug) {
  const tenant = await Tenant.create({ name: `Test ${slug}`, slug });
  return runInTenant(tenant._id, async () => {
    const admin = await User.create({ name: 'Test Admin', role: 'admin', authProvider: 'google',
      googleId: `google-${slug}`, email: `${slug}@example.test` });
    const cashier = new User({ name: 'Test Cashier', role: 'cashier' });
    await cashier.setPin('4291'); await cashier.save();
    const category = await Category.create({ name: 'Food' });
    const item = await MenuItem.create({ name: 'Meal', category: category._id, priceMinor: 10000 });
    const tables = [];
    for (let n = 1; n <= 12; n++) tables.push(await Table.create({ name: `T${n}`, seats: 4, zone: 'Main' }));
    return { tenant, admin, cashier, item, tables, token: signAccessToken(admin), cashierToken: signAccessToken(cashier) };
  });
}
const a = await fixture('reliability-a');
const b = await fixture('reliability-b');
const create = (f, ids, extra = {}) => api(f.token, 'POST', '/orders', {
  type: ids.length ? 'dine-in' : 'takeaway', ...(ids.length ? { tableIds: ids.map(String) } : {}),
  items: [{ menuItemId: String(f.item._id), qty: 2 }], ...extra,
});
try {
 await runInTenant(a.tenant._id, async () => {
  const ids = a.tables.map((table) => String(table._id));
  const requestId = randomUUID();
  const [first, replay] = await Promise.all([
    create(a, ids.slice(0, 3), { clientRequestId: requestId }),
    create(a, ids.slice(0, 3), { clientRequestId: requestId }),
  ]);
  assert([200, 201].includes(first.status), JSON.stringify(first));
  assert([200, 201].includes(replay.status), JSON.stringify(replay));
  t('simultaneous retries return the same order', first.data.order.id === replay.data.order.id);
  const orderId = first.data.order.id;
  t('one shared bill claims all three members', (await Table.countDocuments({ currentOrder: orderId })) === 3);
  t('one kitchen ticket is created', (await Ticket.countDocuments({ order: orderId })) === 1);
  t('table snapshots and ticket labels include all members', first.data.order.tableNames.join('+') === 'T1+T2+T3'
    && (await Ticket.findOne({ order: orderId })).source === 'Table T1 + T2 + T3');
  const mismatch = await create(a, ids.slice(0, 3), { clientRequestId: requestId, items: [{ menuItemId: String(a.item._id), qty: 9 }] });
  t('a request id cannot be reused with different contents', mismatch.status === 409);
  const overlap = await create(a, [ids[2], ids[3]]);
  t('overlap refuses the entire new group', overlap.status === 409
    && (await Table.findById(ids[3])).currentOrder === null);
  const crossTenant = await create(a, [ids[3], String(b.tables[0]._id)]);
  t('another restaurant table is rejected without a partial claim', crossTenant.status === 400
    && (await Table.findById(ids[3])).currentOrder === null);
  t('a different restaurant cannot read the bill', (await api(b.token, 'GET', `/orders/${orderId}`)).status === 404);
  const unmerge = await api(a.token, 'POST', `/tables/${ids[1]}/unmerge`, {});
  t('an open shared bill cannot be unmerged', unmerge.status === 409);
  const transfer = await api(a.token, 'POST', `/tables/${ids[0]}/transfer`, { targetTableId: ids[3] });
  assert.equal(transfer.status, 200, JSON.stringify(transfer));
  const moved = await Order.findById(orderId);
  t('transferring the primary promotes its replacement', String(moved.table) === ids[3]
    && moved.tableIds.map(String).join() === [ids[3], ids[1], ids[2]].join()
    && (await Table.findById(ids[0])).status === 'available');
  t('other members point to the replacement primary', String((await Table.findById(ids[1])).mergedInto) === ids[3]);
  const merge = await api(a.token, 'POST', `/tables/${ids[4]}/merge`, { targetTableId: ids[3] });
  t('a free member can join an existing shared bill', merge.status === 200
    && (await Order.findById(orderId)).tableIds.length === 4);
  const customer = await Customer.create({ name: 'Returning Guest', phone: '9876543210' });
  const current = await Order.findById(orderId);
  const payBody = { paymentMethod: 'cash', version: current.__v, customerId: String(customer._id) };
  const [pay1, pay2] = await Promise.all([
    api(a.token, 'POST', `/orders/${orderId}/pay`, payBody), api(a.token, 'POST', `/orders/${orderId}/pay`, payBody),
  ]);
  assert.equal(pay1.status, 200, JSON.stringify(pay1)); assert.equal(pay2.status, 200, JSON.stringify(pay2));
  t('concurrent payments commit once and replay once', [pay1, pay2].filter((result) => result.data.replayed).length === 1);
  t('customer visits increment once', (await Customer.findById(customer._id)).visitCount === 1);
  t('payment has one audit record', (await AuditLog.countDocuments({ resourceId: orderId, action: 'order.pay' })) === 1);
  const members = await Table.find({ _id: mongoose.trusted({ $in: [ids[1], ids[2], ids[3], ids[4]] }) });
  t('payment detaches every member and keeps guests seated', members.every((table) => !table.currentOrder && !table.mergedInto && table.status === 'occupied'));
  const invoice = [pay1, pay2].find((result) => result.data.invoice)?.data.invoice;
  const publicReceipt = await fetch(`${base}/api/invoice/${new URL(invoice.url).pathname.split('/').at(-1)}`).then((response) => response.json());
  t('public receipt retains all table names', publicReceipt.data?.invoice?.tableName === current.tableNames.join(' + '), JSON.stringify(publicReceipt));

  const voidable = await create(a, [ids[5], ids[6]]);
  const voided = await api(a.token, 'POST', `/orders/${voidable.data.order.id}/void`, { reason: 'Guest cancelled order' });
  t('voiding an unpaid group releases all members', voided.status === 200
    && (await Table.find({ _id: mongoose.trusted({ $in: [ids[5], ids[6]] }) })).every((table) => table.status === 'available' && !table.currentOrder));

  const [race1, race2] = await Promise.all([create(a, [ids[7], ids[8]]), create(a, [ids[8], ids[9]])]);
  t('overlapping terminals produce one winner', [race1, race2].filter((result) => result.status === 201).length === 1
    && [race1, race2].filter((result) => result.status === 409).length === 1);
  const winner = [race1, race2].find((result) => result.status === 201).data.order;
  const losingOnly = race1.status === 201 ? ids[9] : ids[7];
  t('the losing transaction leaves its non-overlapping table free', !(await Table.findById(losingOnly)).currentOrder);
  const snapshot1 = await Order.findById(winner.id);
  const snapshot2 = await Order.findById(winner.id);
  snapshot1.items[0].qty = 3; snapshot1.recalculate(); await snapshot1.save();
  snapshot2.status = 'paid';
  await assert.rejects(snapshot2.save(), mongoose.Error.VersionError);
  t('stale payment writes cannot overwrite edited totals', (await Order.findById(winner.id)).status === 'open');
  const stalePay = await api(a.token, 'POST', `/orders/${winner.id}/pay`, { paymentMethod: 'cash', version: winner.version });
  t('the cashier must review changed totals', stalePay.status === 409);
  const staleEdit = await api(a.token, 'PATCH', `/orders/${winner.id}/items`, {
    version: winner.version, items: [{ menuItemId: String(a.item._id), qty: 1 }],
  });
  t('a stale item edit cannot overwrite another terminal', staleEdit.status === 409);

  const originalRecord = AuditLog.record;
  const failedId = randomUUID();
  let failed;
  try {
    AuditLog.record = function (entry, ...args) {
      if (entry.action === 'order.create') throw new Error('Injected audit write failure');
      return originalRecord.call(this, entry, ...args);
    };
    failed = await create(a, [ids[5], ids[6]], { clientRequestId: failedId });
  } finally { AuditLog.record = originalRecord; }
  t('failure after claiming tables rolls back the entire transaction', failed.status === 500
    && await Order.countDocuments({ clientRequestId: failedId }) === 0
    && (await Table.find({ _id: mongoose.trusted({ $in: [ids[5], ids[6]] }) })).every((table) => !table.currentOrder));
  const recovered = await create(a, [ids[5], ids[6]], { clientRequestId: failedId });
  t('the same request identifier succeeds after a complete rollback', recovered.status === 201);
  const raceOrder = recovered.data.order;
  const [racedPay, racedVoid] = await Promise.all([
    api(a.token, 'POST', `/orders/${raceOrder.id}/pay`, { paymentMethod: 'cash', version: raceOrder.version }),
    api(a.cashierToken, 'POST', `/orders/${raceOrder.id}/void`, { reason: 'Guest cancelled', version: raceOrder.version }),
  ]);
  t('competing payment and void cannot overwrite each other', [racedPay, racedVoid].filter((result) => result.status === 200).length === 1);
  const raceFinal = await Order.findById(raceOrder.id);
  t('the winning payment or void determines the group occupancy',
    (await Table.find({ _id: mongoose.trusted({ $in: [ids[5], ids[6]] }) })).every((table) =>
      !table.currentOrder && table.status === (raceFinal.status === 'paid' ? 'occupied' : 'available')));

  // Expired tickets remain physically present here; every operational API must hide them.
  const ticket = await Ticket.findOne({ order: winner.id });
  await Ticket.collection.updateOne({ _id: ticket._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  t('expired ticket details are unavailable', (await api(a.token, 'GET', `/kitchen/tickets/${ticket._id}`)).status === 404);
  t('expired tickets cannot advance or recall', (await api(a.token, 'PATCH', `/kitchen/tickets/${ticket._id}/advance`, {})).status === 404
    && (await api(a.token, 'PATCH', `/kitchen/tickets/${ticket._id}/recall`, {})).status === 404);
  const board = await api(a.token, 'GET', '/kitchen/board');
  t('board excludes expired tickets immediately', !JSON.stringify(board.data.columns).includes(String(ticket._id)));
  t('ticket expiry preserves the open bill and its tables', (await Order.findById(winner.id)).status === 'open'
    && await Table.countDocuments({ currentOrder: winner.id }) === 2);

  const { recentSince } = serviceWindow();
  const history = Array.from({ length: 115 }, (_, i) => ({
    tenantId: a.tenant._id, orderNo: 500 + i, invoiceNo: `FIXTURE-${i}`, type: 'takeaway', status: 'open',
    createdBy: a.admin._id, items: [{ menuItem: a.item._id, nameSnapshot: 'Meal', priceMinorAtSale: 10000, qty: 1 }],
    totalMinor: 10000, createdAt: new Date(recentSince.getTime() + 1000), updatedAt: new Date(),
  }));
  await Order.collection.insertMany(history);
  const excluded = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({ ...history[0], _id: excluded, invoiceNo: 'OLD-FIXTURE', createdAt: new Date(recentSince - 1) });
  clearAll();
  const dashboard = await api(a.cashierToken, 'GET', '/dashboard');
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard));
  t('dashboard starts with fifty rows and a continuation', dashboard.data.recentOrders.length === 50 && !!dashboard.data.recentNextCursor);
  t('cashier dashboard exposes no admin metrics', !('monthSales' in dashboard.data) && !('topItems' in dashboard.data));
  const seen = [...dashboard.data.recentOrders.map((order) => order.id)];
  let cursor = dashboard.data.recentNextCursor;
  while (cursor) {
    const page = await api(a.cashierToken, 'GET', `/dashboard/recent-orders?cursor=${cursor}`);
    assert.equal(page.status, 200, JSON.stringify(page));
    seen.push(...page.data.recentOrders.map((order) => order.id)); cursor = page.data.recentNextCursor;
  }
  const expected = await Order.countDocuments({ createdAt: mongoose.trusted({ $gte: recentSince }) });
  t('all recent rows are reachable without duplicates at equal timestamps', seen.length === expected && new Set(seen).size === expected);
  t('older orders remain stored but disappear from recent history', !seen.includes(String(excluded)) && !!await Order.findById(excluded));
  const foreignHistory = await api(b.token, 'GET', '/dashboard/recent-orders');
  t('recent pagination stays tenant scoped', foreignHistory.data.recentOrders.length === 0);
  const oldCursor = `${recentSince.getTime() + 1000}_${first.data.order.id}_${recentSince.getTime() - 86400000}`;
  t('a cursor from a previous reset is rejected', (await api(a.token, 'GET', `/dashboard/recent-orders?cursor=${oldCursor}`)).status === 409);
  const daily = await api(a.token, 'GET', `/reports/daily?date=${todayIso()}`);
  t('ticket expiry does not reduce financial totals', daily.data.netMinor === first.data.order.totalMinor
    + (raceFinal.status === 'paid' ? raceOrder.totalMinor : 0));
  t('financial midnight uses India time', dayStart(todayIso()).getUTCHours() === 18);

  const baselineListeners = listenerCount();
  const abort = new AbortController();
  const response = await fetch(`${base}/api/kitchen/stream`, { signal: abort.signal,
    headers: { Authorization: `Bearer ${signStreamToken(a.admin)}` } });
  assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
  const reader = response.body.getReader();
  await reader.read(); // connected frame
  runInTenant(b.tenant._id, () => emitEvent(EVENTS.TICKET_CREATED, { orderId: 'foreign-secret' }));
  emitEvent(EVENTS.TICKET_CREATED, { orderId: 'local-event' });
  const event = new TextDecoder().decode((await reader.read()).value);
  t('authenticated streams carry only their restaurant events', event.includes('local-event') && !event.includes('foreign-secret'));
  abort.abort(); await reader.cancel().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 40));
  t('disconnect cleans up stream listeners', listenerCount() === baselineListeners);

  const sessionFamily = new mongoose.Types.ObjectId();
  const originalSession = signRefreshToken(a.admin, { family: sessionFamily });
  await RefreshToken.issue({ jti: originalSession.jti, token: originalSession.token,
    userId: a.admin._id, family: sessionFamily, expiresAt: originalSession.expiresAt });
  const rotate = () => fetch(`${base}/api/auth/refresh`, { method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE}=${originalSession.token}` } });
  const rotated = await Promise.all([rotate(), rotate()]);
  t('a refresh credential can only rotate once under concurrent use', rotated.filter((r) => r.status === 200).length === 1
    && rotated.filter((r) => r.status === 401).length === 1);
  t('detected refresh reuse revokes every descendant', await RefreshToken.countDocuments({ family: sessionFamily, revokedAt: null }) === 0);

  // Migration: legacy group + ticket, dry run without writes, then backfill/TTL.
  await Ticket.collection.dropIndex('expiresAt_1');
  const legacy = await create(a, [ids[10], ids[11]]);
  assert.equal(legacy.status, 201, JSON.stringify(legacy));
  const legacyTicket = await Ticket.findOne({ order: legacy.data.order.id });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(legacy.data.order.id) }, { $unset: { tableIds: '', tableNames: '' } });
  await Table.collection.updateOne({ _id: a.tables[11]._id }, { $set: { currentOrder: null } });
  const oldPlaced = new Date(serviceWindow().serviceStart.getTime() - 1000);
  await Ticket.collection.updateOne({ _id: legacyTicket._id }, { $unset: { expiresAt: '' }, $set: { placedAt: oldPlaced } });
  const migrationArgs = ['--import', './tests/helpers/register.mjs', 'src/scripts/migrateReliability.js'];
  const options = { cwd: new URL('../..', import.meta.url), env: { ...process.env, MONGO_URI: toTestUri(process.env.MONGO_URI).uri }, encoding: 'utf8', timeout: 30000 };
  const dry = execFileSync(process.execPath, migrationArgs, options);
  t('migration dry run reports expired tickets and performs no writes', dry.includes('dry-run')
    && !(await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(legacy.data.order.id) })).tableIds
    && !!await Ticket.collection.findOne({ _id: legacyTicket._id }));
  execFileSync(process.execPath, [...migrationArgs, '--apply', '--maintenance-confirmed'], options);
  const migrated = await Order.findById(legacy.data.order.id);
  t('migration reconstructs an existing live shared group', migrated.tableIds.length === 2
    && String((await Table.findById(ids[11])).currentOrder) === legacy.data.order.id);
  t('migration removes old kitchen work but keeps the bill', !await Ticket.findById(legacyTicket._id) && !!migrated);
  t('migration installs the single-field TTL index', (await Ticket.collection.indexes()).some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
  t('new tickets expire at their next 4 AM', (await Ticket.findOne({ order: orderId })).expiresAt.getTime()
    === nextServiceReset((await Order.findById(orderId)).createdAt).getTime());

  const purgeTable = await api(a.token, 'POST', '/data-purge/tables', { confirm: 'DELETE' });
  t('table purge refuses to strand open shared bills', purgeTable.status === 409 && await Table.countDocuments({}) === 12);
  t('cashiers cannot invoke financial purges', (await api(a.cashierToken, 'POST', '/data-purge/reports', { confirm: 'DELETE' })).status === 403);
  const foreign = await create(b, [String(b.tables[0]._id)]);
  assert.equal(foreign.status, 201);
  const purge = await api(a.token, 'POST', '/data-purge/reports', { confirm: 'DELETE' });
  t('explicit financial purge removes dependent tickets and table links together', purge.status === 200
    && await Order.countDocuments({}) === 0 && await Ticket.countDocuments({}) === 0
    && await Table.countDocuments({ currentOrder: mongoose.trusted({ $ne: null }) }) === 0);
  t('financial purge cannot delete another restaurant bill', (await api(b.token, 'GET', `/orders/${foreign.data.order.id}`)).status === 200);
 });
} catch (error) {
  t('integration scenarios complete', false, error.stack);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await disconnect();
}
process.exitCode = finish() ? 0 : 1;
