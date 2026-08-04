/**
 * Order endpoints — the money path.
 *
 * ── What a client is allowed to say ────────────────────────────────────────
 * Item ids and quantities. That is the whole vocabulary. There is no price,
 * subtotal or total field in any request here, and the server's schemas reject
 * those keys outright rather than ignoring them, so a compromised or careless
 * client cannot set what a customer is charged. Every total on the returned
 * order is derived server-side from the lines.
 *
 * The one number a cashier does choose is the discount, which is why it has
 * its own endpoint, a ceiling, and a manager-override path.
 */
import { api } from './api';
import type { OrderDto } from './dto';
import type { OrderType } from '../data/types';

export type PaymentMethod = 'cash' | 'card' | 'upi';

export interface OrderLineInput {
  menuItemId: string;
  qty: number;
  note?: string;
}

/** Orders are returned as-is: the DTO is already in major units for display. */
export type Order = OrderDto;

export async function listOrders(
  filter: { status?: 'open' | 'paid' | 'voided'; tableId?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Order[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set('status', filter.status);
  if (filter.tableId) qs.set('tableId', filter.tableId);
  if (filter.limit) qs.set('limit', String(filter.limit));

  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await api<{ orders: OrderDto[] }>(`/api/orders${suffix}`, { signal });
  return data.orders;
}

export async function getOrder(id: string, signal?: AbortSignal): Promise<Order> {
  const data = await api<{ order: OrderDto }>(`/api/orders/${id}`, { signal });
  return data.order;
}

/**
 * Open a bill. Returns the order and the id of the kitchen ticket it created —
 * the two are made in one transaction, so a ticket without an order (or the
 * reverse) is not a state the board can observe.
 *
 * A dine-in order requires a table and the server enforces one open order per
 * table with a unique index, so a second attempt on a seated table is a 409,
 * not a duplicate bill.
 */
export async function createOrder(input: {
  type: OrderType;
  tableId?: string;
  /** An existing customer by id. Mutually exclusive with `customer`. */
  customerId?: string;
  /**
   * A customer captured at the till, keyed by phone. The server finds or
   * creates the record inside the same transaction as the order, so there is
   * no window where a customer exists for a sale that then failed.
   *
   * `name` is only needed when the number is unknown — for a returning
   * customer the server keeps the name it already holds, so a typo at the till
   * cannot rename a regular.
   */
  customer?: { phone: string; name?: string };
  items: OrderLineInput[];
}): Promise<{ order: Order; ticketId: string }> {
  return api<{ order: OrderDto; ticketId: string }>('/api/orders', {
    method: 'POST',
    body: input,
  });
}

/** Replace every line on an open order — the cart being edited. */
export async function updateItems(id: string, items: OrderLineInput[]): Promise<Order> {
  const data = await api<{ order: OrderDto }>(`/api/orders/${id}/items`, {
    method: 'PATCH',
    body: { items },
  });
  return data.order;
}

/**
 * Apply or clear a discount.
 *
 * `value` is a percentage when type is 'percent', and MAJOR currency units
 * when 'fixed' — "2.50", not 250. Pass type: null to clear, in which case the
 * value is ignored. A discount above the cashier ceiling needs
 * `adminOverridePin`; without it the server answers 403 and the UI should
 * prompt for a manager rather than silently dropping the discount.
 */
export async function setDiscount(
  id: string,
  input:
    | { type: null }
    | { type: 'percent' | 'fixed'; value: string; adminOverridePin?: string },
): Promise<Order> {
  const data = await api<{ order: OrderDto }>(`/api/orders/${id}/discount`, {
    method: 'PATCH',
    body: input,
  });
  return data.order;
}

export async function payOrder(
  id: string,
  input: { paymentMethod: PaymentMethod; customerId?: string },
): Promise<Order> {
  const data = await api<{ order: OrderDto }>(`/api/orders/${id}/pay`, {
    method: 'POST',
    body: input,
  });
  return data.order;
}

/**
 * Permanently delete an order. Admin only.
 *
 * Not the same thing as voiding, and not a substitute for it: this removes the
 * row, so the day's takings will no longer reconcile against the till and the
 * only surviving record is the audit entry. The reason is mandatory and the
 * server rejects anything under ten characters.
 */
export async function deleteOrder(id: string, reason: string): Promise<void> {
  await api<{ deleted: boolean; id: string; orderNo: number }>(`/api/orders/${id}`, {
    method: 'DELETE',
    body: { reason },
  });
}

/**
 * Void an order. The reason is mandatory server-side — an unexplained void is
 * indistinguishable in the audit log from theft.
 */
export async function voidOrder(
  id: string,
  input: { reason: string; adminOverridePin?: string },
): Promise<Order> {
  const data = await api<{ order: OrderDto }>(`/api/orders/${id}/void`, {
    method: 'POST',
    body: input,
  });
  return data.order;
}
