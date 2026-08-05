import type { MenuItem, OrderEntry, TicketItem, TicketStatus } from '../data/types';

/**
 * Covers on a kitchen ticket.
 *
 * Separate from `orderCount` because a ticket carries name snapshots rather
 * than menu item ids — the kitchen is never sent prices, so there is nothing
 * to resolve and no total to compute.
 */
export const ticketItemCount = (items: TicketItem[]) =>
  items.reduce((sum, line) => sum + line.qty, 0);

export interface ResolvedLine {
  id: string;
  name: string;
  price: number;
  qty: number;
}

export const resolveOrder = (order: OrderEntry[], items: MenuItem[]): ResolvedLine[] =>
  order.flatMap(([id, qty]) => {
    const item = items.find((x) => x.id === id);
    return item ? [{ id: item.id, name: item.name, price: item.price, qty }] : [];
  });

export const orderValue = (order: OrderEntry[], items: MenuItem[]) =>
  resolveOrder(order, items).reduce((sum, l) => sum + l.price * l.qty, 0);

export const orderCount = (order: OrderEntry[]) => order.reduce((sum, [, qty]) => sum + qty, 0);

export const STATUS_BADGE: Record<TicketStatus, { bg: string; fg: string; label: string }> = {
  pending: { bg: '#d4e9e2', fg: '#00754A', label: 'Pending' },
  preparing: { bg: '#f8ecd2', fg: '#6b4f12', label: 'Preparing' },
  ready: { bg: 'rgba(200,32,20,0.10)', fg: '#c82014', label: 'Ready' },
  served: { bg: '#f4f3f0', fg: 'rgba(0,0,0,0.45)', label: 'Served' },
};
