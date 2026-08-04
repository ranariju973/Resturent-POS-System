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
  cat: string;
  img: string;
  desc?: string;
  available: boolean;
}

export interface Category {
  name: string;
  color: string;
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
  order: OrderEntry[];
  startedAt: number | null;
  merge: string | null;
}

export type TicketStatus = 'pending' | 'preparing' | 'ready' | 'served';
export type OrderType = 'dine-in' | 'takeaway' | 'delivery';

export interface Ticket {
  id: string;
  no: number;
  source: string;
  type: OrderType;
  status: TicketStatus;
  order: OrderEntry[];
  placedAt: number;
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
