export type Role = 'Cashier' | 'Kitchen Staff' | 'Admin';

export interface Staff {
  name: string;
  role: Role;
  avatar: string;
}

export interface StaffWithPin extends Staff {
  pin: string;
}

export type ScreenId =
  | 'dashboard'
  | 'billing'
  | 'menu'
  | 'tables'
  | 'kitchen'
  | 'customers'
  | 'reports';

export interface NavEntry {
  id: ScreenId;
  label: string;
  icon: string;
  group: 'ops' | 'mgmt';
  blurb: string;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  /**
   * Category id, not name. Names are editable server-side, so keying items by
   * name meant a rename silently orphaned every item pointing at the old
   * string. `catName` is carried alongside purely for display.
   */
  cat: string;
  catName: string;
  img: string;
  desc?: string;
  available: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Live count from the list endpoint; absent on a freshly created category. */
  itemCount?: number;
}

export interface CartLine {
  id: string;
  qty: number;
  note: string;
  noteOpen: boolean;
}

export type TableStatus = 'available' | 'occupied' | 'reserved';

/** [menu item id, quantity] — the compact order shape shared by tables, tickets and history. */
export type OrderEntry = [string, number];

export interface Table {
  id: string;
  name: string;
  seats: number;
  zone: string;
  status: TableStatus;
  startedAt: number | null;
  merge: string | null;
  /**
   * The floor view gets a summary of the open bill, not the bill itself — the
   * server does not expand order lines on the tables endpoint. Fetch the order
   * by `orderId` when a cashier actually opens it.
   */
  orderId: string | null;
  orderTotal: number;
  orderItemCount: number;
}

export type TicketStatus = 'pending' | 'preparing' | 'ready' | 'served';
export type OrderType = 'dine-in' | 'takeaway' | 'delivery';

/** A kitchen line, as snapshotted onto the order at sale time. */
export interface TicketItem {
  name: string;
  qty: number;
  note: string;
}

export interface Ticket {
  id: string;
  no: number;
  source: string;
  type: OrderType;
  status: TicketStatus;
  nextStatus: TicketStatus | null;
  /**
   * Name snapshots, not menu item ids — the kitchen is never sent prices, and
   * a ticket for a since-deleted item still has to print correctly. Render
   * these directly rather than resolving against the menu.
   */
  items: TicketItem[];
  placedAt: number;
  waitingMinutes: number;
  wasRecalled: boolean;
  orderId: string;
}

export interface CustomerOrder {
  date: string;
  status: TicketStatus;
  order: OrderEntry[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  last: string;
  history: CustomerOrder[];
}

export type ExpenseCategory = 'Ingredients' | 'Utilities' | 'Salary' | 'Rent' | 'Other';

export interface Expense {
  id: string;
  date: string;
  cat: ExpenseCategory;
  desc: string;
  amt: number;
}

export interface KdsColumn {
  id: TicketStatus;
  label: string;
  next: TicketStatus | null;
  cta: string;
  icon: string;
}
