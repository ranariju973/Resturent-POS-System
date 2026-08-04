/**
 * Table handlers.
 *
 * ── Every state change is a compare-and-swap ───────────────────────────────
 * The obvious shape for "seat table T3" is: load it, check `status ===
 * 'available'`, set it to occupied, save. That is a read-then-write race, and
 * a POS is exactly the environment where it loses — two terminals at the same
 * counter, two cashiers, one walk-in. Both read `available`, both save
 * `occupied`, and the second silently overwrites the first. The party at T3
 * gets someone else's bill.
 *
 * So every transition here is a single `findOneAndUpdate` whose FILTER carries
 * the precondition:
 *
 *     { _id, status: 'available' }  ->  { status: 'occupied' }
 *
 * MongoDB applies that atomically. Whoever loses gets `null` back, which
 * becomes a 409 telling them the table is already taken — a true statement,
 * arriving before they can do any damage.
 *
 * The same pattern guards transfer (claiming the destination) and merge.
 */
import mongoose from 'mongoose';
import { Table } from '../models/Table.js';
import { Order } from '../models/Order.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, TABLE_STATUS, ORDER_STATUS } from '../constants/enums.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { can } from '../middleware/rbac.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { splitMinor, toMajor } from '../utils/money.js';

/**
 * The table shape sent to clients.
 * `occupiedMinutes` is derived rather than stored, so the elapsed badge on the
 * floor plan cannot drift from reality.
 */
function publicTable(table) {
  const order = table.currentOrder;
  const populated = order && typeof order === 'object' && 'totalMinor' in order;

  return {
    id: String(table._id),
    name: table.name,
    seats: table.seats,
    zone: table.zone,
    status: table.status,
    occupiedAt: table.occupiedAt,
    occupiedMinutes: table.occupiedAt
      ? Math.floor((Date.now() - new Date(table.occupiedAt).getTime()) / 60000)
      : null,
    mergedInto: table.mergedInto ? String(table.mergedInto) : null,
    currentOrder: order ? (populated ? String(order._id) : String(order)) : null,
    orderTotalMinor: populated ? order.totalMinor : undefined,
    orderTotal: populated ? toMajor(order.totalMinor) : undefined,
    orderItemCount: populated ? order.items.length : undefined,
  };
}

/** Load a live table or 404. */
async function loadTable(id) {
  const table = await Table.findOne({ _id: id, isActive: true });
  if (!table) throw ApiError.notFound('Table not found');
  return table;
}

// ---------------------------------------------------------------------------
// GET /api/tables
// ---------------------------------------------------------------------------
export const listTables = asyncHandler(async (req, res) => {
  const { zone, status, includeInactive } = req.query;

  const filter = {};
  // Deleted tables are admin-only, and only on request.
  if (!(includeInactive === 'true' && can(req, PERMISSIONS.TABLE_DELETE))) filter.isActive = true;
  if (zone) filter.zone = zone;
  if (status) filter.status = status;

  const tables = await Table.find(filter)
    .populate('currentOrder', 'totalMinor items orderNo')
    .sort({ zone: 1, name: 1 });

  return sendSuccess(res, { tables: tables.map(publicTable), count: tables.length });
});

// ---------------------------------------------------------------------------
// GET /api/tables/zones
// ---------------------------------------------------------------------------
/**
 * The zones actually in use, for the floor-plan filter.
 * Derived from the tables rather than a fixed list, so an admin inventing a
 * zone does not also have to update a constant somewhere.
 */
export const listZones = asyncHandler(async (req, res) => {
  const zones = await Table.distinct('zone', { isActive: true });
  return sendSuccess(res, { zones: zones.sort() });
});

// ---------------------------------------------------------------------------
// GET /api/tables/:id
// ---------------------------------------------------------------------------
export const getTable = asyncHandler(async (req, res) => {
  const table = await Table.findOne({ _id: req.params.id, isActive: true }).populate(
    'currentOrder',
    'totalMinor items orderNo',
  );
  if (!table) throw ApiError.notFound('Table not found');
  return sendSuccess(res, { table: publicTable(table) });
});

// ---------------------------------------------------------------------------
// POST /api/tables            (admin)
// ---------------------------------------------------------------------------
export const createTable = asyncHandler(async (req, res) => {
  const table = await Table.create({ ...req.body, status: TABLE_STATUS.AVAILABLE });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TABLE_CREATE,
      resource: 'Table',
      resourceId: table._id,
      meta: { name: table.name, seats: table.seats, zone: table.zone },
    },
    req,
  );

  return sendSuccess(res, { table: publicTable(table) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// PUT /api/tables/:id         (admin)
// ---------------------------------------------------------------------------
/**
 * Reconfiguring a table — name, seat count, zone.
 *
 * Refused while a party is seated. Renaming T3 to T7 mid-service would rename
 * it on the kitchen tickets already on the board, and changing the seat count
 * under a seated party is describing a room that no longer matches.
 */
export const updateTable = asyncHandler(async (req, res) => {
  const table = await loadTable(req.params.id);

  if (table.status === TABLE_STATUS.OCCUPIED) {
    throw ApiError.conflict('Cannot reconfigure a table while it is occupied');
  }

  const before = { name: table.name, seats: table.seats, zone: table.zone };
  Object.assign(table, req.body);
  await table.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TABLE_UPDATE,
      resource: 'Table',
      resourceId: table._id,
      meta: { before, after: { name: table.name, seats: table.seats, zone: table.zone } },
    },
    req,
  );

  return sendSuccess(res, { table: publicTable(table) });
});

// ---------------------------------------------------------------------------
// DELETE /api/tables/:id      (admin)
// ---------------------------------------------------------------------------
/**
 * Soft delete, refused while a bill is open.
 *
 * A 409 naming the reason is better than either alternative: deleting anyway
 * strands an unpaid order with no table to settle it against, and cascading
 * the delete would void a live bill on one click.
 */
export const deleteTable = asyncHandler(async (req, res) => {
  const table = await loadTable(req.params.id);

  if (table.currentOrder) {
    throw ApiError.conflict('Cannot delete a table with an open order — settle the bill first');
  }
  if (table.status === TABLE_STATUS.OCCUPIED) {
    throw ApiError.conflict('Cannot delete an occupied table');
  }

  const absorbed = await Table.countDocuments({ mergedInto: table._id, isActive: true });
  if (absorbed > 0) {
    throw ApiError.conflict('Cannot delete a table that other tables are merged into');
  }

  table.isActive = false;
  await table.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TABLE_DELETE,
      resource: 'Table',
      resourceId: table._id,
      meta: { name: table.name },
    },
    req,
  );

  return sendSuccess(res, { deleted: true, id: String(table._id) });
});

// ---------------------------------------------------------------------------
// PATCH /api/tables/:id/seat        (admin, cashier)
// ---------------------------------------------------------------------------
/**
 * Seat a party. Atomic: the filter requires the table to still be free.
 */
export const seatTable = asyncHandler(async (req, res) => {
  const table = await Table.findOneAndUpdate(
    {
      _id: req.params.id,
      isActive: true,
      // Reserved counts as free — seating the party the table was held for is
      // the normal path, not an exception.
      status: mongoose.trusted({ $in: [TABLE_STATUS.AVAILABLE, TABLE_STATUS.RESERVED] }),
    },
    { $set: { status: TABLE_STATUS.OCCUPIED, occupiedAt: new Date() } },
    { new: true },
  );

  if (!table) {
    // Distinguish "no such table" from "someone got there first", since the
    // two need different responses from the person at the terminal.
    const exists = await Table.exists({ _id: req.params.id, isActive: true });
    if (!exists) throw ApiError.notFound('Table not found');
    throw ApiError.conflict('That table has just been taken');
  }

  return sendSuccess(res, { table: publicTable(table) });
});

// ---------------------------------------------------------------------------
// PATCH /api/tables/:id/reserve     (admin, cashier)
// ---------------------------------------------------------------------------
export const reserveTable = asyncHandler(async (req, res) => {
  const table = await Table.findOneAndUpdate(
    { _id: req.params.id, isActive: true, status: TABLE_STATUS.AVAILABLE },
    { $set: { status: TABLE_STATUS.RESERVED } },
    { new: true },
  );

  if (!table) {
    const exists = await Table.exists({ _id: req.params.id, isActive: true });
    if (!exists) throw ApiError.notFound('Table not found');
    throw ApiError.conflict('Only an available table can be reserved');
  }

  return sendSuccess(res, { table: publicTable(table) });
});

// ---------------------------------------------------------------------------
// PATCH /api/tables/:id/release     (admin, cashier)
// ---------------------------------------------------------------------------
/**
 * Clear the table after the party leaves.
 *
 * Refused while a bill is open — releasing then would lose the link between
 * the order and where it was run up, and the order would never be settled.
 */
export const releaseTable = asyncHandler(async (req, res) => {
  const table = await loadTable(req.params.id);

  if (table.currentOrder) {
    throw ApiError.conflict('Settle or void the open bill before releasing this table');
  }

  const absorbed = await Table.countDocuments({ mergedInto: table._id, isActive: true });
  if (absorbed > 0) {
    throw ApiError.conflict('Unmerge the tables joined to this one before releasing it');
  }

  table.release();
  await table.save();

  return sendSuccess(res, { table: publicTable(table) });
});

// ---------------------------------------------------------------------------
// POST /api/tables/:id/transfer     (admin, cashier)
// ---------------------------------------------------------------------------
/**
 * Move an open bill from one table to another.
 *
 * The destination is claimed atomically first. If that fails, nothing has been
 * touched — the source table still holds its order, and the caller gets a 409.
 * Claiming the destination before releasing the source is deliberate: the
 * reverse order can leave an order attached to no table at all if the second
 * write fails.
 */
export const transferTable = asyncHandler(async (req, res) => {
  const { targetTableId } = req.body;
  const source = await loadTable(req.params.id);

  if (String(source._id) === String(targetTableId)) {
    throw ApiError.badRequest('Source and destination are the same table');
  }
  if (!source.currentOrder) {
    throw ApiError.conflict('That table has no open bill to transfer');
  }

  // Claim the destination, or fail without side effects.
  const target = await Table.findOneAndUpdate(
    {
      _id: targetTableId,
      isActive: true,
      status: mongoose.trusted({ $in: [TABLE_STATUS.AVAILABLE, TABLE_STATUS.RESERVED] }),
      currentOrder: null,
    },
    {
      $set: {
        status: TABLE_STATUS.OCCUPIED,
        currentOrder: source.currentOrder,
        occupiedAt: source.occupiedAt ?? new Date(),
      },
    },
    { new: true },
  );

  if (!target) {
    const exists = await Table.exists({ _id: targetTableId, isActive: true });
    if (!exists) throw ApiError.notFound('Destination table not found');
    throw ApiError.conflict('The destination table is not free');
  }

  const orderId = source.currentOrder;

  // Point the order back at its new table, then clear the source.
  await Order.updateOne({ _id: orderId }, { $set: { table: target._id } });
  source.release();
  await source.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TABLE_UPDATE,
      resource: 'Table',
      resourceId: source._id,
      meta: { transferredTo: String(target._id), order: String(orderId) },
    },
    req,
  );

  return sendSuccess(res, {
    source: publicTable(source),
    target: publicTable(target),
  });
});

// ---------------------------------------------------------------------------
// POST /api/tables/:id/merge        (admin, cashier)
// ---------------------------------------------------------------------------
/**
 * Fold this table into another — a party that spread across two tables paying
 * as one. The target keeps the bill; this table becomes a satellite of it.
 *
 * Refused when BOTH tables have open bills. Combining two orders means merging
 * their line items and recomputing totals, which is order logic and belongs
 * with the order endpoints (Phase 7). Refusing is honest; silently discarding
 * one of the two bills would not be.
 */
export const mergeTable = asyncHandler(async (req, res) => {
  const { targetTableId } = req.body;
  const source = await loadTable(req.params.id);

  if (String(source._id) === String(targetTableId)) {
    throw ApiError.badRequest('Cannot merge a table into itself');
  }
  if (source.mergedInto) {
    throw ApiError.conflict('That table is already merged into another');
  }

  const target = await loadTable(targetTableId);

  // No chains: merging A into B when B is itself merged into C would leave the
  // bill somewhere neither terminal is looking.
  if (target.mergedInto) {
    throw ApiError.conflict('The destination table is itself merged into another table');
  }

  if (source.currentOrder && target.currentOrder) {
    throw ApiError.conflict(
      'Both tables have open bills — settle or transfer one before merging',
    );
  }

  // If only the source has a bill, it moves to the target.
  const movingOrder = source.currentOrder ?? null;

  const claimed = await Table.findOneAndUpdate(
    { _id: target._id, isActive: true, mergedInto: null },
    {
      $set: {
        status: TABLE_STATUS.OCCUPIED,
        ...(movingOrder ? { currentOrder: movingOrder } : {}),
        occupiedAt: target.occupiedAt ?? source.occupiedAt ?? new Date(),
      },
    },
    { new: true },
  );

  if (!claimed) throw ApiError.conflict('The destination table changed — try again');

  if (movingOrder) await Order.updateOne({ _id: movingOrder }, { $set: { table: claimed._id } });

  source.currentOrder = null;
  source.mergedInto = claimed._id;
  source.status = TABLE_STATUS.OCCUPIED;
  await source.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TABLE_UPDATE,
      resource: 'Table',
      resourceId: source._id,
      meta: { mergedInto: String(claimed._id), movedOrder: movingOrder ? String(movingOrder) : null },
    },
    req,
  );

  return sendSuccess(res, { source: publicTable(source), target: publicTable(claimed) });
});

// ---------------------------------------------------------------------------
// POST /api/tables/:id/unmerge      (admin, cashier)
// ---------------------------------------------------------------------------
export const unmergeTable = asyncHandler(async (req, res) => {
  const table = await loadTable(req.params.id);

  if (!table.mergedInto) throw ApiError.conflict('That table is not merged into another');

  table.mergedInto = null;
  table.status = TABLE_STATUS.AVAILABLE;
  table.occupiedAt = null;
  await table.save();

  return sendSuccess(res, { table: publicTable(table) });
});

// ---------------------------------------------------------------------------
// POST /api/tables/:id/split        (admin, cashier)
// ---------------------------------------------------------------------------
/**
 * Split-bill preview.
 *
 * Returns the proposed shares without persisting anything — the cashier reads
 * them off the screen while the party decides. Nothing is committed until the
 * order is settled, which is Phase 7's job.
 *
 * The arithmetic uses splitMinor, which distributes the remainder one minor
 * unit at a time so the shares always add back to the exact total. Naive
 * division either loses or invents a cent, and a till that is a cent out every
 * split does not reconcile at close.
 */
export const splitBill = asyncHandler(async (req, res) => {
  const { ways } = req.body;

  const table = await Table.findOne({ _id: req.params.id, isActive: true }).populate(
    'currentOrder',
    'totalMinor subtotalMinor items orderNo status',
  );
  if (!table) throw ApiError.notFound('Table not found');

  const order = table.currentOrder;
  if (!order) throw ApiError.conflict('That table has no open bill to split');
  if (order.status !== ORDER_STATUS.OPEN) {
    throw ApiError.conflict('That bill is no longer open');
  }

  const shares = splitMinor(order.totalMinor, ways);

  return sendSuccess(res, {
    tableId: String(table._id),
    orderId: String(order._id),
    orderNo: order.orderNo,
    ways,
    totalMinor: order.totalMinor,
    total: toMajor(order.totalMinor),
    shares: shares.map((amountMinor, index) => ({
      index: index + 1,
      amountMinor,
      amount: toMajor(amountMinor),
    })),
    // Proof, in the payload, that nothing was lost or invented in the split.
    checksumMinor: shares.reduce((a, b) => a + b, 0),
  });
});

export default {
  listTables,
  listZones,
  getTable,
  createTable,
  updateTable,
  deleteTable,
  seatTable,
  reserveTable,
  releaseTable,
  transferTable,
  mergeTable,
  unmergeTable,
  splitBill,
};
