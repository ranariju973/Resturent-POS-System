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
  | 'reports'
  | 'employees'
  | 'printer';

export interface NavEntry {
  id: ScreenId;
  label: string;
  /**
   * What the mobile tab bar shows. "Menu Management" across a fifth of a
   * 375px screen either truncates to "Menu Mana…" or shrinks to unreadable,
   * so the bar gets its own one-word name and the sidebar keeps the full one.
   */
  short: string;
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

/**
 * One settled (or open) bill in a customer's history, as the server sends it.
 *
 * Separate from `CustomerOrder` above, which was built for the old local demo
 * data and keyed items by menu id. Real history carries NAME SNAPSHOTS taken
 * at the time of sale, so a bill still reads correctly after an item is
 * renamed, repriced or removed from the menu entirely.
 */
export interface CustomerBill {
  id: string;
  orderNo: number;
  type: string;
  status: string;
  /** Major units. */
  total: number;
  itemCount: number;
  /** Epoch ms. `paidAt` is null while the bill is still open. */
  createdAt: number;
  paidAt: number | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  /** Last visit, YYYY-MM-DD. Empty when they have never been billed. */
  last: string;
  /** Settled bills. Comes from the server — never counted from `history`. */
  orderCount: number;
  /** Major units. Paid orders only, summed server-side at their sale price. */
  lifetimeSpend: number;
  visitCount: number;
  /** Undefined until the history endpoint is called — NOT the same as empty. */
  history?: CustomerBill[];
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

// ---------------------------------------------------------------------------
// Employees, attendance and payroll
// ---------------------------------------------------------------------------

/** The wire form of a role. `Role` above is the display label. */
export type ApiRole = 'admin' | 'cashier' | 'kitchen_staff';

/** Roles that sign in with a PIN — the only ones this screen can create. */
export type StaffRole = Exclude<ApiRole, 'admin'>;

export interface Employee {
  id: string;
  name: string;
  role: ApiRole;
  roleLabel: string;
  phone: string;
  /** YYYY-MM-DD, or '' when never recorded. A calendar day, not a timestamp. */
  joinedOn: string;
  /** Major units, converted at the DTO boundary. */
  monthlySalary: number;
  notes: string;
  isActive: boolean;
  /** Whether a login PIN is set. Never the PIN itself. */
  hasPin: boolean;
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';

/** One roster row on the Attendance tab. `status: null` means "not yet marked". */
export interface AttendanceRow {
  employeeId: string;
  name: string;
  roleLabel: string;
  status: AttendanceStatus | null;
  notes: string;
}

export type PayrollStatus = 'draft' | 'paid';

export interface PayrollRow {
  employeeId: string;
  name: string;
  roleLabel: string;
  status: PayrollStatus;
  baseSalary: number;
  daysInMonth: number;
  markedDays: number;
  payableDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  earned: number;
  bonus: number;
  deduction: number;
  net: number;
  paidAt: number | null;
  notes: string;
}

export interface PayrollTotals {
  earned: number;
  bonus: number;
  deduction: number;
  net: number;
  employees: number;
  paid: number;
}
