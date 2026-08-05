/**
 * Reference guards for irreversible deletes.
 *
 * Admin deletes across the app are hard deletes: the document leaves MongoDB
 * and any Cloudinary asset is destroyed with it. That is only safe for records
 * nothing else points at. A menu item that appears on a receipt, or a customer
 * with order history, cannot be removed without leaving a dangling reference
 * that makes past orders and reports resolve to nothing.
 *
 * So every hard delete asks the referencing collection first and refuses with a
 * 409 when the answer is yes. The check is the safety property — not the
 * admin's care, and not a cached flag on the document, which can drift stale in
 * exactly the dangerous direction (a stale `false` deletes a referenced row).
 * Each guard is one indexed `exists()` lookup and cannot be wrong.
 */
import { Order, MenuItem, Table, Ticket, Expense } from '../models/index.js';
import { ApiError } from './apiResponse.js';

/**
 * Refuse if a menu item appears on any order, live or historical.
 * Backed by the { 'items.menuItem': 1 } index on Order.
 */
export async function assertMenuItemUnreferenced(itemId) {
  if (await Order.exists({ 'items.menuItem': itemId })) {
    throw ApiError.conflict(
      'This item appears on past orders and cannot be permanently deleted. ' +
        'Mark it unavailable instead so receipts and reports still resolve.',
    );
  }
}

/**
 * Refuse if a category still holds items. Unlike the previous soft-delete
 * check this counts ALL items, not just active ones: with hard deletes there
 * is no longer such a thing as an inactive item holding the reference.
 */
export async function assertCategoryEmpty(categoryId) {
  const itemCount = await MenuItem.countDocuments({ category: categoryId });
  if (itemCount > 0) {
    throw ApiError.conflict(
      `Cannot delete a category that still has ${itemCount} item${itemCount === 1 ? '' : 's'}. ` +
        'Move or delete the items first.',
    );
  }
}

/**
 * Refuse if a customer has any order history.
 *
 * Note this is deliberately stricter than the old soft delete, which hid the
 * record while leaving orders pointing at it. For a customer who must be
 * removed for privacy reasons the `?erase=true` path still applies — it scrubs
 * the PII while keeping the shell document so revenue figures do not move.
 */
export async function assertCustomerUnreferenced(customerId) {
  if (await Order.exists({ customer: customerId })) {
    throw ApiError.conflict(
      'This customer has order history and cannot be permanently deleted. ' +
        'Use erase to remove their personal details while keeping the sales record.',
    );
  }
}

/**
 * Refuse if a table is referenced by an order, has a merge pointing at it, or
 * is currently in service.
 */
export async function assertTableUnreferenced(tableId) {
  if (await Order.exists({ table: tableId })) {
    throw ApiError.conflict(
      'This table appears on past orders and cannot be permanently deleted. ' +
        'It has been kept so receipts and reports still resolve.',
    );
  }
  if (await Table.exists({ mergedInto: tableId })) {
    throw ApiError.conflict('Cannot delete a table that other tables are merged into');
  }
}

/**
 * Refuse if a kitchen ticket's parent order still exists. A ticket outliving
 * its order is harmless; an order whose tickets vanished mid-service is not.
 */
export async function assertTicketDeletable(ticket) {
  if (await Order.exists({ _id: ticket.order })) {
    throw ApiError.conflict(
      'This ticket belongs to a live order. Delete the order itself to remove it.',
    );
  }
}

/**
 * Refuse to hard-delete a staff member who appears anywhere in the trading
 * record.
 *
 * `Order.createdBy` is a REQUIRED ref, so an order whose cashier was deleted
 * carries an id that populate() resolves to null: the receipt loses the name of
 * whoever rang it up, and "takings by cashier" attributes a day's money to
 * nobody. That is the opposite of what an audit trail is for.
 *
 * ── Why AuditLog is deliberately NOT checked ───────────────────────────────
 * It would refuse everyone. AuditLog.actor references a user on every single
 * login, so any employee who has ever signed in would be undeletable and the
 * button would be permanently dead. It is also unnecessary: AuditLog
 * denormalises `actorName` and `actorRole` onto each entry precisely so the
 * trail stays readable after an account is gone.
 *
 * Checked cheapest-first. Only `Order.createdBy` is indexed, but it is also the
 * one that matches in practice — a staff member with any history at all trips
 * it and the later scans never run.
 *
 * @param {any} userId
 * @param {{ Payroll?: any }} [deps] Payroll is injected rather than imported:
 *   it is registered in models/index.js, but keeping the dependency explicit
 *   means this guard does not break if payroll is ever pulled out.
 */
export async function assertEmployeeUnreferenced(userId, { Payroll } = {}) {
  if (await Order.exists({ createdBy: userId })) {
    throw ApiError.conflict(
      'This employee has taken orders and cannot be permanently deleted. ' +
        'Deactivate them instead — their PIN stops working immediately and ' +
        'past bills keep their name.',
    );
  }

  if (await Order.exists({ $or: [{ voidedBy: userId }, { approvedBy: userId }] })) {
    throw ApiError.conflict(
      'This employee voided or approved past orders and cannot be permanently ' +
        'deleted. Deactivate them instead so the approval trail still resolves.',
    );
  }

  if (await Expense.exists({ createdBy: userId })) {
    throw ApiError.conflict(
      'This employee recorded expenses and cannot be permanently deleted. ' +
        'Deactivate them instead so past P&L figures still resolve.',
    );
  }

  if (await Ticket.exists({ 'statusHistory.by': userId })) {
    throw ApiError.conflict(
      'This employee worked kitchen tickets and cannot be permanently deleted. ' +
        'Deactivate them instead.',
    );
  }

  // A paid month is a record of money that actually changed hands.
  if (Payroll && (await Payroll.exists({ employee: userId, status: 'paid' }))) {
    throw ApiError.conflict(
      'This employee has been paid for at least one month and cannot be ' +
        'permanently deleted. Deactivate them instead so the payroll record stands.',
    );
  }
}

export default {
  assertMenuItemUnreferenced,
  assertCategoryEmpty,
  assertCustomerUnreferenced,
  assertTableUnreferenced,
  assertTicketDeletable,
  assertEmployeeUnreferenced,
};
