import type {
  Category,
  Customer,
  Expense,
  ExpenseCategory,
  KdsColumn,
  MenuItem,
  NavEntry,
  Staff,
  StaffWithPin,
  Table,
  Ticket,
} from './types';

export const STAFF: StaffWithPin[] = [
  { pin: '1042', name: 'Priya Nair', role: 'Cashier', avatar: 'https://i.pravatar.cc/96?img=45' },
  {
    pin: '2318',
    name: 'Marco Reyes',
    role: 'Kitchen Staff',
    avatar: 'https://i.pravatar.cc/96?img=12',
  },
  { pin: '7781', name: 'Nahid Zaman', role: 'Cashier', avatar: 'https://i.pravatar.cc/96?img=32' },
];

export const ADMIN: Staff = {
  name: 'Aisha Verma',
  role: 'Admin',
  avatar: 'https://i.pravatar.cc/96?img=47',
};

export const NAV: NavEntry[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'lucide:layout-dashboard',
    group: 'ops',
    blurb: 'Sales, covers and shift performance at a glance.',
  },
  {
    id: 'billing',
    label: 'POS Billing',
    icon: 'lucide:receipt',
    group: 'ops',
    blurb: 'Take an order, apply discounts and settle the bill.',
  },
  {
    id: 'menu',
    label: 'Menu Management',
    icon: 'lucide:book-open',
    group: 'mgmt',
    blurb: 'Items, categories, pricing and availability.',
  },
  {
    id: 'tables',
    label: 'Table Management',
    icon: 'lucide:grid-2x2',
    group: 'mgmt',
    blurb: 'Floor plan, seating status and table turnover.',
  },
  {
    id: 'kitchen',
    label: 'Kitchen Management',
    icon: 'lucide:chef-hat',
    group: 'mgmt',
    blurb: 'Live kitchen tickets and prep queue.',
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: 'lucide:users',
    group: 'mgmt',
    blurb: 'Customer records and order history.',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'lucide:bar-chart-3',
    group: 'mgmt',
    blurb: 'Sales, expenses and profitability.',
  },
];

export const MENU_SEED: Omit<MenuItem, 'available'>[] = [
  {
    id: 'p1',
    name: 'Cold Brew',
    price: 4.25,
    cat: 'Beverages',
    img: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=280&h=280&fit=crop',
  },
  {
    id: 'p2',
    name: 'Vanilla Latte',
    price: 4.75,
    cat: 'Beverages',
    img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=280&h=280&fit=crop',
  },
  {
    id: 'p3',
    name: 'Iced Matcha',
    price: 5.25,
    cat: 'Beverages',
    img: 'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?w=280&h=280&fit=crop',
  },
  {
    id: 'p4',
    name: 'Shrimp Basil Salad',
    price: 10.0,
    cat: 'Salads',
    img: 'https://images.unsplash.com/photo-1626200419199-391ae4be7a41?w=280&h=280&fit=crop',
  },
  {
    id: 'p5',
    name: 'Garden Greens',
    price: 8.5,
    cat: 'Salads',
    img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=280&h=280&fit=crop',
  },
  {
    id: 'p6',
    name: 'Roast Tomato Soup',
    price: 6.0,
    cat: 'Soup',
    img: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=280&h=280&fit=crop',
  },
  {
    id: 'p7',
    name: 'Sweet Corn Soup',
    price: 5.75,
    cat: 'Soup',
    img: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=280&h=280&fit=crop',
  },
  {
    id: 'p8',
    name: 'Margherita Pizza',
    price: 12.5,
    cat: 'Pizza',
    img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=280&h=280&fit=crop',
  },
  {
    id: 'p9',
    name: 'Vegetable Pizza',
    price: 13.0,
    cat: 'Pizza',
    img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=280&h=280&fit=crop',
  },
  {
    id: 'p10',
    name: 'Chicken Biryani',
    price: 11.75,
    cat: 'Rice',
    img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=280&h=280&fit=crop',
  },
  {
    id: 'p11',
    name: 'Egg Fried Rice',
    price: 9.0,
    cat: 'Rice',
    img: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=280&h=280&fit=crop',
  },
  {
    id: 'p12',
    name: 'Steamed Jasmine Rice',
    price: 3.5,
    cat: 'Rice',
    img: 'https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=280&h=280&fit=crop',
  },
  {
    id: 'p13',
    name: 'Onion Rings',
    price: 5.0,
    cat: 'Salads',
    img: 'https://images.unsplash.com/photo-1639024471283-03518883512d?w=280&h=280&fit=crop',
  },
  {
    id: 'p14',
    name: 'Chicken Burger',
    price: 10.5,
    cat: 'Pizza',
    img: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=280&h=280&fit=crop',
  },
  {
    id: 'p15',
    name: 'Fish & Chips',
    price: 13.5,
    cat: 'Pizza',
    img: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=280&h=280&fit=crop',
  },
  {
    id: 'p16',
    name: 'Blueberry Muffin',
    price: 3.25,
    cat: 'Beverages',
    img: 'https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=280&h=280&fit=crop',
  },
];

export const CAT_SEED: Category[] = [
  { name: 'Beverages', color: '#00754A' },
  { name: 'Rice', color: '#cba258' },
  { name: 'Salads', color: '#2b5148' },
  { name: 'Soup', color: '#1E3932' },
  { name: 'Pizza', color: '#8a6a24' },
];

export const SWATCHES = ['#00754A', '#1E3932', '#2b5148', '#cba258', '#8a6a24'];
export const ZONES = ['All', 'Indoor', 'Outdoor', 'AC'];

export const KDS_COLS: KdsColumn[] = [
  { id: 'pending', label: 'Pending', next: 'preparing', cta: 'Start Preparing', icon: 'lucide:play' },
  { id: 'preparing', label: 'Preparing', next: 'ready', cta: 'Mark Ready', icon: 'lucide:flame' },
  { id: 'ready', label: 'Ready', next: 'served', cta: 'Mark Served', icon: 'lucide:bell-ring' },
  { id: 'served', label: 'Served', next: null, cta: '', icon: 'lucide:check' },
];

const TICKET_SEED: (Omit<Ticket, 'placedAt'> & { mins: number })[] = [
  { id: 'K1', no: 41, source: 'Table T3', type: 'dine-in', status: 'pending', mins: 3, order: [['p10', 2], ['p6', 1]] },
  { id: 'K2', no: 42, source: 'Takeaway', type: 'takeaway', status: 'pending', mins: 7, order: [['p14', 1], ['p1', 2]] },
  { id: 'K3', no: 43, source: 'Table T1', type: 'dine-in', status: 'preparing', mins: 12, order: [['p2', 2], ['p16', 1]] },
  { id: 'K4', no: 44, source: 'Delivery', type: 'delivery', status: 'preparing', mins: 6, order: [['p8', 1], ['p3', 2], ['p13', 1]] },
  { id: 'K5', no: 45, source: 'Table T6', type: 'dine-in', status: 'preparing', mins: 2, order: [['p4', 1]] },
  { id: 'K6', no: 46, source: 'Table P4', type: 'dine-in', status: 'ready', mins: 14, order: [['p11', 1], ['p7', 2]] },
  { id: 'K7', no: 47, source: 'Takeaway', type: 'takeaway', status: 'ready', mins: 4, order: [['p15', 1]] },
  { id: 'K8', no: 40, source: 'Table T5', type: 'dine-in', status: 'served', mins: 26, order: [['p12', 2], ['p9', 1]] },
];

const TABLE_SEED: (Omit<Table, 'startedAt' | 'merge'> & { mins?: number })[] = [
  { id: 'T1', name: 'T1', seats: 2, zone: 'Indoor', status: 'occupied', mins: 18, order: [['p2', 2], ['p16', 1]] },
  { id: 'T2', name: 'T2', seats: 4, zone: 'Indoor', status: 'available', order: [] },
  { id: 'T3', name: 'T3', seats: 4, zone: 'Indoor', status: 'occupied', mins: 63, order: [['p10', 2], ['p6', 1], ['p1', 2]] },
  { id: 'T4', name: 'T4', seats: 6, zone: 'Indoor', status: 'reserved', order: [] },
  { id: 'T5', name: 'T5', seats: 2, zone: 'Indoor', status: 'available', order: [] },
  { id: 'T6', name: 'T6', seats: 4, zone: 'AC', status: 'occupied', mins: 34, order: [['p8', 1], ['p3', 2]] },
  { id: 'T7', name: 'T7', seats: 8, zone: 'AC', status: 'available', order: [] },
  { id: 'T8', name: 'T8', seats: 4, zone: 'AC', status: 'reserved', order: [] },
  { id: 'P1', name: 'P1', seats: 4, zone: 'Outdoor', status: 'occupied', mins: 7, order: [['p4', 1], ['p1', 1]] },
  { id: 'P2', name: 'P2', seats: 2, zone: 'Outdoor', status: 'available', order: [] },
  { id: 'P3', name: 'P3', seats: 6, zone: 'Outdoor', status: 'available', order: [] },
  { id: 'P4', name: 'P4', seats: 2, zone: 'Outdoor', status: 'occupied', mins: 51, order: [['p14', 2], ['p11', 1]] },
];

export const CUSTOMERS: Customer[] = [
  {
    id: 'c1',
    name: 'Aarav Mehta',
    phone: '+91 98200 41122',
    email: 'aarav.mehta@mail.com',
    notes: 'Prefers window seat. No coriander.',
    last: 'Aug 1, 2026',
    history: [
      { date: 'Aug 1, 2026', status: 'served', order: [['p2', 2], ['p16', 1]] },
      { date: 'Jul 24, 2026', status: 'served', order: [['p10', 1], ['p6', 1], ['p1', 2]] },
      { date: 'Jul 9, 2026', status: 'served', order: [['p8', 1], ['p3', 1]] },
    ],
  },
  {
    id: 'c2',
    name: 'Sana Kapoor',
    phone: '+91 99870 30456',
    email: '',
    notes: 'Allergic to shellfish.',
    last: 'Jul 30, 2026',
    history: [
      { date: 'Jul 30, 2026', status: 'served', order: [['p5', 1], ['p7', 2]] },
      { date: 'Jul 12, 2026', status: 'served', order: [['p11', 1]] },
    ],
  },
  {
    id: 'c3',
    name: 'Devan Rao',
    phone: '+91 90040 88213',
    email: 'devan@rao.co',
    notes: '',
    last: 'Aug 2, 2026',
    history: [
      { date: 'Aug 2, 2026', status: 'preparing', order: [['p14', 2], ['p1', 1]] },
      { date: 'Jul 27, 2026', status: 'served', order: [['p9', 1], ['p13', 2]] },
      { date: 'Jul 19, 2026', status: 'served', order: [['p12', 2]] },
      { date: 'Jun 30, 2026', status: 'served', order: [['p4', 1], ['p2', 1]] },
    ],
  },
  {
    id: 'c4',
    name: 'Meera Iyer',
    phone: '+91 98455 77310',
    email: 'meera.iyer@mail.com',
    notes: 'Regular — always takeaway.',
    last: 'Jul 28, 2026',
    history: [
      { date: 'Jul 28, 2026', status: 'served', order: [['p15', 1], ['p3', 1]] },
      { date: 'Jul 15, 2026', status: 'served', order: [['p16', 3]] },
    ],
  },
  {
    id: 'c5',
    name: 'Karan Bhatt',
    phone: '+91 97110 26644',
    email: '',
    notes: '',
    last: 'Jul 21, 2026',
    history: [{ date: 'Jul 21, 2026', status: 'served', order: [['p10', 1], ['p11', 1]] }],
  },
];

export const EXP_CATS: ExpenseCategory[] = ['Ingredients', 'Utilities', 'Salary', 'Rent', 'Other'];

export const EXPENSES: Expense[] = [
  { id: 'e1', date: '2026-08-01', cat: 'Ingredients', desc: 'Produce & dairy — weekly market run', amt: 1840.5 },
  { id: 'e2', date: '2026-07-30', cat: 'Salary', desc: 'Kitchen staff — July payroll', amt: 6200 },
  { id: 'e3', date: '2026-07-28', cat: 'Utilities', desc: 'Electricity and water', amt: 742.35 },
  { id: 'e4', date: '2026-07-25', cat: 'Rent', desc: 'Storefront lease — August', amt: 3400 },
  { id: 'e5', date: '2026-07-22', cat: 'Ingredients', desc: 'Coffee beans — 40kg', amt: 1290 },
  { id: 'e6', date: '2026-07-18', cat: 'Other', desc: 'POS terminal maintenance', amt: 210 },
  { id: 'e7', date: '2026-07-12', cat: 'Ingredients', desc: 'Bakery supplies', amt: 655.8 },
];

export const HOURLY: [string, number][] = [
  ['8a', 145], ['9a', 262], ['10a', 318], ['11a', 402], ['12p', 736], ['1p', 812],
  ['2p', 604], ['3p', 288], ['4p', 231], ['5p', 355], ['6p', 588], ['7p', 902],
  ['8p', 848], ['9p', 512], ['10p', 214],
];

export const TOP_ITEMS: [string, number][] = [
  ['p10', 46], ['p8', 31], ['p2', 58], ['p14', 27], ['p9', 22], ['p4', 19], ['p3', 34], ['p15', 14],
];

export const MONTH_DAYS = [
  412, 508, 366, 691, 744, 902, 1128, 486, 522, 610, 588, 733, 981, 1204, 455, 512, 604, 688, 712,
  866, 1092, 498, 534, 621, 703, 795, 1015, 1187, 588, 642, 719,
];

export const PAYMENTS: [string, number, string][] = [
  ['Cash', 4820, '#1E3932'],
  ['Card', 9640, '#00754A'],
  ['UPI', 7215, '#cba258'],
];

/** Reference figures the prototype compares against; no historical data behind them yet. */
export const PREV_MONTH_SALES = 19840;
export const PREV_MONTH_EXPENSES = 13900;
export const MONTH_ORDERS = 812;
export const DAY_ORDERS = 148;

export const initialMenuItems = (): MenuItem[] =>
  MENU_SEED.map((p) => ({ ...p, available: true }));

export const initialTables = (now: number): Table[] =>
  TABLE_SEED.map(({ mins, ...t }) => ({
    ...t,
    startedAt: mins ? now - mins * 60000 : null,
    merge: null,
  }));

export const initialTickets = (now: number): Ticket[] =>
  TICKET_SEED.map(({ mins, ...t }) => ({ ...t, placedAt: now - mins * 60000 }));
