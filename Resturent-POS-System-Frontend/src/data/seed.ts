/**
 * Static UI configuration.
 *
 * Every array of invented data that used to live here is gone — menu, tables,
 * tickets, customers, expenses and the report figures all come from the API
 * now. What remains is genuinely static: navigation, the kitchen board's
 * columns, the colour swatches offered when naming a category, and the expense
 * categories, which are a fixed enum shared with the server.
 */
import type { ExpenseCategory, KdsColumn, NavEntry } from './types';

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
export const SWATCHES = ['#00754A', '#1E3932', '#2b5148', '#cba258', '#8a6a24'];

export const KDS_COLS: KdsColumn[] = [
  { id: 'pending', label: 'Pending', next: 'preparing', cta: 'Start Preparing', icon: 'lucide:play' },
  { id: 'preparing', label: 'Preparing', next: 'ready', cta: 'Mark Ready', icon: 'lucide:flame' },
  { id: 'ready', label: 'Ready', next: 'served', cta: 'Mark Served', icon: 'lucide:bell-ring' },
  { id: 'served', label: 'Served', next: null, cta: '', icon: 'lucide:check' },
];
export const EXP_CATS: ExpenseCategory[] = ['Ingredients', 'Utilities', 'Salary', 'Rent', 'Other'];