/**
 * Client-side permission helpers.
 *
 * ── These hide things. They do not protect them. ───────────────────────────
 * Everything here operates on the permission list the server sent with the
 * session. A determined user can edit that list in memory and make the Reports
 * tab reappear — and then every request it fires comes back 403, because the
 * server re-derives permissions from the role stored in the database and never
 * reads the client's copy.
 *
 * So: use this to avoid offering a control that would fail, never as the
 * reason something is safe.
 *
 * The strings must match src/constants/permissions.js on the backend exactly.
 */
import type { ScreenId } from '../data/types';

export const PERMISSIONS = {
  DASHBOARD_VIEW_FULL: 'dashboard:view:full',
  DASHBOARD_VIEW_LIMITED: 'dashboard:view:limited',

  POS_CREATE_ORDER: 'pos:create_order',
  POS_APPLY_DISCOUNT: 'pos:apply_discount',
  POS_VOID_ORDER: 'pos:void_order',
  POS_OVERRIDE: 'pos:override',
  /** Permanent deletion of an order. Admin only — see the backend catalogue. */
  ORDER_DELETE: 'order:delete',

  MENU_VIEW: 'menu:view',
  MENU_CREATE: 'menu:create',
  MENU_EDIT: 'menu:edit',
  MENU_DELETE: 'menu:delete',
  MENU_TOGGLE_STOCK: 'menu:toggle_stock',

  TABLE_VIEW: 'table:view',
  TABLE_CREATE: 'table:create',
  TABLE_EDIT: 'table:edit',
  TABLE_DELETE: 'table:delete',
  TABLE_MANAGE_SEATING: 'table:manage_seating',

  KITCHEN_VIEW: 'kitchen:view',
  KITCHEN_ADVANCE_STATUS: 'kitchen:advance_status',
  KITCHEN_RECALL: 'kitchen:recall',

  CUSTOMER_VIEW: 'customer:view',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_EDIT: 'customer:edit',
  CUSTOMER_DELETE: 'customer:delete',

  REPORTS_VIEW: 'reports:view',

  USER_MANAGE: 'user:manage',
  AUDIT_VIEW: 'audit:view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Which permission a screen needs before it is worth showing at all. */
export const SCREEN_PERMISSION: Record<ScreenId, Permission[]> = {
  // Either dashboard grant gets you the screen; the payload differs.
  dashboard: [PERMISSIONS.DASHBOARD_VIEW_FULL, PERMISSIONS.DASHBOARD_VIEW_LIMITED],
  billing: [PERMISSIONS.POS_CREATE_ORDER],
  menu: [PERMISSIONS.MENU_VIEW],
  tables: [PERMISSIONS.TABLE_VIEW],
  kitchen: [PERMISSIONS.KITCHEN_VIEW],
  customers: [PERMISSIONS.CUSTOMER_VIEW],
  reports: [PERMISSIONS.REPORTS_VIEW],
};

/** Does the session hold this permission? Missing list => nothing. */
export function can(permissions: string[] | undefined, permission: Permission): boolean {
  return Boolean(permissions?.includes(permission));
}

export function canAny(permissions: string[] | undefined, wanted: Permission[]): boolean {
  return wanted.some((p) => can(permissions, p));
}

/** May this screen be shown? */
export function canViewScreen(permissions: string[] | undefined, screen: ScreenId): boolean {
  return canAny(permissions, SCREEN_PERMISSION[screen] ?? []);
}

/**
 * The first screen this session may actually open.
 *
 * Ordered by what each role most likely wants on sign-in: a cashier lands on
 * billing, kitchen staff on the board. Without this, kitchen staff would sign
 * in to the stored default of `billing` and see an empty guard screen.
 */
export function defaultScreen(permissions: string[] | undefined): ScreenId {
  const order: ScreenId[] = ['billing', 'kitchen', 'dashboard', 'tables', 'menu', 'customers', 'reports'];
  return order.find((s) => canViewScreen(permissions, s)) ?? 'kitchen';
}
