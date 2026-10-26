/** Dry run by default. Run during a maintenance window after a verified backup. */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { nextServiceReset } from '../utils/date.js';

const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--maintenance-confirmed')) {
  throw new Error('--apply requires --maintenance-confirmed; stop old writers and take a backup first');
}

async function migrate() {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false });
  const db = mongoose.connection.db;
  const orders = db.collection('orders');
  const tables = db.collection('tables');
  const tickets = db.collection('tickets');
  const allTables = await tables.find({}, { projection: {
    _id: 1, tenantId: 1, name: 1, currentOrder: 1, mergedInto: 1, isActive: 1,
  } }).toArray();
  const tableById = new Map(allTables.map((table) => [String(table._id), table]));
  const claims = new Map();
  const openOrders = new Set();
  let orderCount = 0;
  const projection = { _id: 1, tenantId: 1, table: 1, tableIds: 1, tableNames: 1, status: 1, __v: 1 };
  const membership = (order) => {
    let ids = order.tableIds?.length ? order.tableIds.map(String) : order.table ? [String(order.table)] : [];
    if (order.status === 'open' && order.table) ids = [...new Set([...ids, ...allTables
      .filter((table) => String(table.mergedInto) === String(order.table) && String(table.tenantId) === String(order.tenantId))
      .map((table) => String(table._id))])];
    return ids;
  };
  const problems = [];
  const now = new Date();
  for await (const order of orders.find({}, { projection }).batchSize(250)) {
    if (!order.tenantId) { problems.push({ order: String(order._id), issue: 'Missing tenant' }); continue; }
    const open = order.status === 'open';
    if (open) openOrders.add(String(order._id));
    const ids = membership(order);
    if (ids.length > 50 || (ids.length && ids[0] !== String(order.table))
      || ids.some((id) => !mongoose.isValidObjectId(id)) || new Set(ids).size !== ids.length) {
      problems.push({ order: String(order._id), issue: 'Invalid primary, member IDs or too many members' }); continue;
    }
    const members = ids.map((id) => tableById.get(id));
    if (open && members.some((table) => !table || !table.isActive || String(table.tenantId) !== String(order.tenantId)
      || (table.currentOrder && String(table.currentOrder) !== String(order._id)))) {
      problems.push({ order: String(order._id), issue: 'Missing, inactive, cross-tenant or conflicting table' }); continue;
    }
    if (open) for (const id of ids) {
      const key = `${order.tenantId}:${id}`;
      if (claims.has(key)) problems.push({ order: String(order._id), issue: 'Two open bills claim the same table' });
      claims.set(key, String(order._id));
    }
    orderCount++;
  }
  for (const table of allTables) {
    if (table.currentOrder && (!openOrders.has(String(table.currentOrder))
      || claims.get(`${table.tenantId}:${table._id}`) !== String(table.currentOrder))) {
      problems.push({ table: String(table._id), issue: 'Table points to a missing, settled or inconsistent bill' });
    }
  }
  let stale = 0;
  let ticketCount = 0;
  for await (const ticket of tickets.find({}, { projection: { _id: 1, tenantId: 1, placedAt: 1 } }).batchSize(250)) {
    ticketCount++;
    if (!ticket.tenantId || !(ticket.placedAt instanceof Date) || !Number.isFinite(ticket.placedAt.getTime())) {
      problems.push({ ticket: String(ticket._id), issue: 'Missing tenant or invalid placement date' });
    } else if (nextServiceReset(ticket.placedAt) <= now) stale++;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', orders: orderCount,
    tickets: ticketCount, expiredTickets: stale, problems }, null, 2));
  if (problems.length) throw new Error('Repair the reported inconsistencies and repeat the dry run before applying');
  if (!apply) return;

  // Idempotent, tenant-qualified backfill. A version mismatch stops deployment.
  for await (const order of orders.find({}, { projection }).batchSize(250)) {
    const ids = membership(order);
    // Closed historical groups cannot be reconstructed; preserve known snapshots.
    const names = order.tableNames?.length ? order.tableNames : ids.map((id) => tableById.get(id))
      .filter((table) => table && String(table.tenantId) === String(order.tenantId)).map((table) => table.name);
    const updated = await orders.updateOne({ _id: order._id, tenantId: order.tenantId,
      ...(order.__v === undefined ? { __v: { $exists: false } } : { __v: order.__v }) },
    { $set: { tableIds: ids.map((id) => new mongoose.Types.ObjectId(id)), tableNames: names, __v: order.__v ?? 0 } });
    if (!updated.matchedCount) throw new Error('An order changed during migration. Stop writers and repeat the dry run.');
    if (order.status === 'open') for (const id of ids) {
      await tables.updateOne({ _id: new mongoose.Types.ObjectId(id), tenantId: order.tenantId },
        { $set: { currentOrder: order._id, status: 'occupied', mergedInto: id === ids[0] ? null : order.table } });
    }
  }
  // Backfill expiry in bounded batches. Missing dates never silently gain a new lifetime.
  let batch = [];
  for await (const ticket of tickets.find({}, { projection: { _id: 1, tenantId: 1, placedAt: 1 } }).batchSize(250)) {
    batch.push({ updateOne: { filter: { _id: ticket._id, tenantId: ticket.tenantId },
      update: { $set: { expiresAt: nextServiceReset(ticket.placedAt) } } } });
    if (batch.length === 250) { await tickets.bulkWrite(batch); batch = []; }
  }
  if (batch.length) await tickets.bulkWrite(batch);
  // Drain the backlog before enabling TTL to avoid a single large deletion burst.
  while (true) {
    const expired = await tickets.find({ expiresAt: { $lte: now } }, { projection: { _id: 1, tenantId: 1 } }).limit(250).toArray();
    if (!expired.length) break;
    await tickets.bulkWrite(expired.map((ticket) => ({ deleteOne: {
      filter: { _id: ticket._id, tenantId: ticket.tenantId, expiresAt: { $lte: now } },
    } })));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Targeted additions only. Do not run syncIndexes(), which can drop unrelated indexes.
  await orders.createIndex({ tenantId: 1, tableIds: 1 }, { unique: true,
    partialFilterExpression: { status: 'open', 'tableIds.0': { $exists: true } } });
  await orders.createIndex({ tenantId: 1, clientRequestId: 1 }, { unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string' } } });
  await orders.createIndex({ tenantId: 1, createdAt: -1, _id: -1 });
  await tickets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  console.log('Backfill, batched ticket cleanup, and targeted indexes complete.');
}

migrate().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
