/**
 * The table shape sent to clients.
 *
 * Lived in tableController until createOrder needed it too: opening a bill
 * seats the table, and returning the seated table in that response is what
 * lets the till patch its floor state instead of refetching the whole floor.
 * Duplicating the shape would have meant two serialisers drifting apart, and
 * the floor plan reading a field one of them had stopped sending.
 *
 * `occupiedMinutes` is derived rather than stored, so the elapsed badge on the
 * floor plan cannot drift from reality.
 */
import { toMajor } from './money.js';

export function publicTable(table) {
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

export default publicTable;
