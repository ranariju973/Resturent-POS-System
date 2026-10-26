import mongoose from 'mongoose';
import { Table } from '../models/Table.js';
import { Ticket } from '../models/Ticket.js';
import { publicTable } from './publicTable.js';
import { ApiError } from './apiResponse.js';

export const orderTableIds = (order) => order.tableIds?.length
  ? order.tableIds.map(String) : order.table ? [String(order.table)] : [];

export const tableSource = (type, names) => type === 'dine-in'
  ? `Table ${names.join(' + ')}` : type === 'takeaway' ? 'Takeaway' : 'Delivery';

/** Reads/updates must share the transaction with the associated order. */
export async function detachOrderTables(order, session, release = false) {
  if (!order.table && !order.tableIds?.length) return [];
  const tables = await Table.find({ currentOrder: order._id }).session(session);
  if (!tables.length) return [];
  await Table.updateMany({ currentOrder: order._id }, { $set: {
    currentOrder: null, mergedInto: null,
    ...(release ? { status: 'available', occupiedAt: null } : {}),
  } }, { session });
  return tables.map((table) => {
    table.currentOrder = null;
    table.mergedInto = null;
    if (release) { table.status = 'available'; table.occupiedAt = null; }
    return publicTable(table);
  });
}

/** Persist the whole group together; callers claim/release members in this transaction. */
export async function setOrderTables(order, ids, session) {
  const tables = await Table.find({ _id: mongoose.trusted({ $in: ids }), isActive: true }).session(session);
  const byId = new Map(tables.map((table) => [String(table._id), table]));
  if (tables.length !== ids.length) throw ApiError.conflict('A table in this group is unavailable');
  const ordered = ids.map((id) => byId.get(String(id)));
  order.table = ids[0];
  order.tableIds = ids;
  order.tableNames = ordered.map((table) => table.name);
  await order.save({ session });
  for (const table of ordered) {
    table.currentOrder = order._id;
    table.status = 'occupied';
    table.occupiedAt ??= new Date();
    table.mergedInto = String(table._id) === String(ids[0]) ? null : ids[0];
    await table.save({ session });
  }
  await Ticket.updateOne({ order: order._id }, { $set: {
    source: tableSource(order.type, order.tableNames),
  } }, { session });
  return ordered.map((table) => {
    table.currentOrder = order;
    return publicTable(table);
  });
}
