/**
 * The wire shapes the backend actually returns, and the mappers that turn them
 * into the UI types in `data/types.ts`.
 *
 * ── Why a separate layer rather than reusing the UI types ──────────────────
 * The two disagree in three places, and each disagreement is deliberate on the
 * server's side:
 *
 *   1. Money. The server speaks minor units (`priceMinor: 42550`) and includes
 *      a major-unit convenience field. The UI works in major units. Reading
 *      the wrong one is off by 100x and looks like a pricing bug, so the
 *      conversion happens once, here.
 *
 *   2. Identity. The server keys categories by ObjectId; the UI used to key
 *      them by name. Names are editable, so a rename would have silently
 *      orphaned every item referencing the old string. `cat` now holds an id.
 *
 *   3. Dates. The server sends ISO 8601; the UI does arithmetic on epoch
 *      milliseconds. `Date.parse` once at the boundary beats `new Date(...)`
 *      scattered through render paths.
 *
 * Nothing outside this file should touch a `*Minor` field or an ISO string.
 */
import type {
  Category,
  Customer,
  MenuItem,
  OrderType,
  Table,
  TableStatus,
  Ticket,
  TicketStatus,
} from '../data/types';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface CategoryDto {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Present on the list endpoint only. */
  itemCount?: number;
}

export interface MenuItemDto {
  id: string;
  name: string;
  priceMinor: number;
  price: number;
  category: string;
  categoryName?: string;
  categoryColor?: string;
  description: string;
  imageUrl: string;
  available: boolean;
  isActive: boolean;
  updatedAt: string;
}

export interface OrderLineDto {
  id: string;
  menuItem: string;
  name: string;
  qty: number;
  note: string;
  unitPriceMinor: number;
  unitPrice: number;
  lineTotalMinor: number;
  lineTotal: number;
}

export interface OrderDto {
  id: string;
  orderNo: number;
  type: OrderType;
  status: 'open' | 'paid' | 'voided';
  table: string | null;
  customer: string | null;
  items: OrderLineDto[];
  subtotalMinor: number;
  subtotal: number;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number;
  discountMinor: number;
  discount: number;
  taxRate: number;
  taxMinor: number;
  tax: number;
  totalMinor: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'upi' | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string;
  approvedBy: string | null;
  createdBy: string;
  createdAt: string;
}

export interface TableDto {
  id: string;
  name: string;
  seats: number;
  zone: string;
  status: TableStatus;
  occupiedAt: string | null;
  occupiedMinutes: number | null;
  mergedInto: string | null;
  currentOrder: string | null;
  orderTotalMinor?: number;
  orderTotal?: number;
  orderItemCount?: number;
}

export interface TicketItemDto {
  name: string;
  qty: number;
  note: string;
}

export interface TicketDto {
  id: string;
  no: number;
  source: string;
  type: OrderType;
  status: TicketStatus;
  nextStatus: TicketStatus | null;
  placedAt: string;
  readyAt: string | null;
  waitingMinutes: number;
  order: string;
  /** Absent unless the endpoint populated the order. */
  items?: TicketItemDto[];
  wasRecalled: boolean;
}

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  lastOrderAt: string | null;
  orderCount?: number;
  totalSpentMinor?: number;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** ISO 8601 to epoch ms, tolerating the nulls the server sends for "never". */
export const toEpoch = (iso: string | null | undefined): number | null =>
  iso ? Date.parse(iso) : null;

export const toCategory = (dto: CategoryDto): Category => ({
  id: dto.id,
  name: dto.name,
  color: dto.color,
  sortOrder: dto.sortOrder,
  itemCount: dto.itemCount,
});

export const toMenuItem = (dto: MenuItemDto): MenuItem => ({
  id: dto.id,
  name: dto.name,
  // `price` is the server's own major-unit conversion of priceMinor, so this
  // never re-derives it and never disagrees with the receipt.
  price: dto.price,
  cat: dto.category,
  catName: dto.categoryName ?? '',
  img: dto.imageUrl,
  desc: dto.description,
  available: dto.available,
});

/**
 * A table's open order, as the table endpoint reports it.
 *
 * The server deliberately does not expand the order lines here — the floor
 * view needs a total and a line count, not a bill. `Table.order` therefore
 * carries only what the endpoint knows; the full order is fetched by id when
 * a cashier actually opens the bill.
 */
export const toTable = (dto: TableDto): Table => ({
  id: dto.id,
  name: dto.name,
  seats: dto.seats,
  zone: dto.zone,
  status: dto.status,
  startedAt: toEpoch(dto.occupiedAt),
  merge: dto.mergedInto,
  orderId: dto.currentOrder,
  orderTotal: dto.orderTotal ?? 0,
  orderItemCount: dto.orderItemCount ?? 0,
});

/**
 * Kitchen tickets carry name snapshots, not menu item ids — the kitchen has no
 * business resolving prices, so the server never sends them. The board renders
 * `items` directly rather than looking anything up in the menu, which also
 * means a ticket for a since-deleted item still prints correctly.
 */
export const toTicket = (dto: TicketDto): Ticket => ({
  id: dto.id,
  no: dto.no,
  source: dto.source,
  type: dto.type,
  status: dto.status,
  nextStatus: dto.nextStatus,
  items: dto.items ?? [],
  placedAt: Date.parse(dto.placedAt),
  waitingMinutes: dto.waitingMinutes,
  wasRecalled: dto.wasRecalled,
  orderId: dto.order,
});

export const toCustomer = (dto: CustomerDto): Customer => ({
  id: dto.id,
  name: dto.name,
  phone: dto.phone,
  email: dto.email,
  notes: dto.notes,
  last: dto.lastOrderAt ? dto.lastOrderAt.slice(0, 10) : '',
  history: [],
});
