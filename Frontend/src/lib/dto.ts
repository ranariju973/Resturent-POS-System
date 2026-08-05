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
  ApiRole,
  CustomerBill,
  AttendanceRow,
  AttendanceStatus,
  Category,
  Customer,
  Employee,
  MenuItem,
  OrderType,
  PayrollRow,
  PayrollStatus,
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
  /**
   * Bumped by the server on every settled bill (Customer.recordVisit). This
   * used to be declared here as `lastOrderAt`, which the server has never sent
   * — so it read `undefined` forever and Last Visit rendered blank on every
   * customer, on a field that was on the wire the whole time.
   */
  lastVisitAt: string | null;
  visitCount: number;
  /** Present on both the list and the detail view. Paid orders only. */
  lifetimeSpendMinor?: number;
  lifetimeSpend?: number;
  paidOrderCount?: number;
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

export interface CustomerBillDto {
  id: string;
  orderNo: number;
  type: string;
  status: string;
  total: number;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
}

export const toCustomerBill = (dto: CustomerBillDto): CustomerBill => ({
  id: dto.id,
  orderNo: dto.orderNo,
  type: dto.type,
  status: dto.status,
  total: dto.total,
  itemCount: dto.itemCount,
  createdAt: Date.parse(dto.createdAt),
  paidAt: toEpoch(dto.paidAt),
});

/**
 * `history` is deliberately left undefined rather than `[]`.
 *
 * The list endpoint does not carry order history, and an empty array is a
 * claim — it is what made the panel say "No orders yet" for regulars with
 * years of custom. Undefined says "not loaded", which the screen can render
 * honestly.
 */
export const toCustomer = (dto: CustomerDto): Customer => ({
  id: dto.id,
  name: dto.name,
  phone: dto.phone,
  email: dto.email,
  notes: dto.notes,
  last: dto.lastVisitAt ? dto.lastVisitAt.slice(0, 10) : '',
  visitCount: dto.visitCount ?? 0,
  orderCount: dto.paidOrderCount ?? 0,
  lifetimeSpend: dto.lifetimeSpend ?? 0,
});

// ---------------------------------------------------------------------------
// Employees, attendance and payroll
// ---------------------------------------------------------------------------

export interface EmployeeDto {
  id: string;
  name: string;
  role: ApiRole;
  roleLabel: string;
  phone: string;
  joinedOn: string | null;
  monthlySalary: number;
  monthlySalaryMinor: number;
  employmentNotes: string;
  isActive: boolean;
  hasPin: boolean;
}

export interface AttendanceDayDto {
  date: string;
  marked: number;
  rows: Array<{
    employee: { id: string; name: string; role: ApiRole; roleLabel: string };
    recordId: string | null;
    status: AttendanceStatus | null;
    notes: string;
  }>;
}

/**
 * One employee's month of attendance, as the calendar reads it.
 *
 * The server answers with an `employees` array even when filtered to one
 * person, so the client takes `[0]`.
 */
export interface AttendanceMonthDto {
  month: string;
  daysInMonth: number;
  employees: Array<{
    employee: { id: string; name: string; role: ApiRole; roleLabel: string };
    records: Array<{ id: string; date: string; status: AttendanceStatus; notes: string }>;
    summary: Record<string, number>;
  }>;
}

export interface PayrollRowDto {
  employee: { id: string; name: string; role: ApiRole; roleLabel: string };
  month: string;
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
  paidAt: string | null;
  notes: string;
}

/**
 * `joinedOn` stays a YYYY-MM-DD string rather than becoming epoch ms: it is a
 * calendar day the UI displays and posts back verbatim, never a moment it does
 * arithmetic on. Slicing the ISO date avoids a timezone shift turning the 1st
 * into the 31st of the month before.
 */
export const toEmployee = (dto: EmployeeDto): Employee => ({
  id: dto.id,
  name: dto.name,
  role: dto.role,
  roleLabel: dto.roleLabel,
  phone: dto.phone ?? '',
  joinedOn: dto.joinedOn ? dto.joinedOn.slice(0, 10) : '',
  monthlySalary: dto.monthlySalary ?? 0,
  notes: dto.employmentNotes ?? '',
  isActive: dto.isActive,
  hasPin: dto.hasPin,
});

export const toAttendanceRow = (row: AttendanceDayDto['rows'][number]): AttendanceRow => ({
  employeeId: row.employee.id,
  name: row.employee.name,
  roleLabel: row.employee.roleLabel,
  status: row.status,
  notes: row.notes ?? '',
});

export const toPayrollRow = (dto: PayrollRowDto): PayrollRow => ({
  employeeId: dto.employee.id,
  name: dto.employee.name,
  roleLabel: dto.employee.roleLabel,
  status: dto.status,
  baseSalary: dto.baseSalary,
  daysInMonth: dto.daysInMonth,
  markedDays: dto.markedDays,
  payableDays: dto.payableDays,
  presentDays: dto.presentDays,
  absentDays: dto.absentDays,
  halfDays: dto.halfDays,
  leaveDays: dto.leaveDays,
  earned: dto.earned,
  bonus: dto.bonus,
  deduction: dto.deduction,
  net: dto.net,
  paidAt: toEpoch(dto.paidAt),
  notes: dto.notes ?? '',
});
