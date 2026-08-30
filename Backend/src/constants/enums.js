/**
 * Shared enums.
 *
 * Single source of truth for every string union in the system. Models,
 * validators (Phase 5+) and the RBAC map (Phase 3) all import from here so a
 * status can never be spelled two different ways in two different files.
 */

// --- Roles -----------------------------------------------------------------
// snake_case on the wire and in the database. The frontend's display labels
// ('Cashier', 'Kitchen Staff', 'Admin') are a presentation concern and are
// mapped in ROLE_LABELS below — never stored.
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  CASHIER: 'cashier',
  KITCHEN_STAFF: 'kitchen_staff',
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.CASHIER]: 'Cashier',
  [ROLES.KITCHEN_STAFF]: 'Kitchen Staff',
});

/** Roles that sign in with a numeric PIN rather than email + password. */
export const PIN_ROLES = Object.freeze([ROLES.CASHIER, ROLES.KITCHEN_STAFF]);

// --- Tables ----------------------------------------------------------------
export const TABLE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  RESERVED: 'reserved',
});

export const TABLE_STATUS_VALUES = Object.freeze(Object.values(TABLE_STATUS));

/**
 * Legal table transitions, enforced server-side in Phase 6.
 * A client asking for anything not listed here is rejected.
 */
export const TABLE_TRANSITIONS = Object.freeze({
  [TABLE_STATUS.AVAILABLE]: [TABLE_STATUS.OCCUPIED, TABLE_STATUS.RESERVED],
  [TABLE_STATUS.RESERVED]: [TABLE_STATUS.OCCUPIED, TABLE_STATUS.AVAILABLE],
  [TABLE_STATUS.OCCUPIED]: [TABLE_STATUS.AVAILABLE],
});

// --- Orders ----------------------------------------------------------------
export const ORDER_TYPE = Object.freeze({
  DINE_IN: 'dine-in',
  TAKEAWAY: 'takeaway',
  DELIVERY: 'delivery',
});

export const ORDER_TYPE_VALUES = Object.freeze(Object.values(ORDER_TYPE));

export const ORDER_STATUS = Object.freeze({
  OPEN: 'open',
  PAID: 'paid',
  VOIDED: 'voided',
});

export const ORDER_STATUS_VALUES = Object.freeze(Object.values(ORDER_STATUS));

export const PAYMENT_METHOD = Object.freeze({
  CASH: 'cash',
  CARD: 'card',
  UPI: 'upi',
});

export const PAYMENT_METHOD_VALUES = Object.freeze(Object.values(PAYMENT_METHOD));

export const DISCOUNT_TYPE = Object.freeze({
  PERCENT: 'percent',
  FIXED: 'fixed',
});

export const DISCOUNT_TYPE_VALUES = Object.freeze(Object.values(DISCOUNT_TYPE));

// --- Kitchen tickets -------------------------------------------------------
export const TICKET_STATUS = Object.freeze({
  PENDING: 'pending',
  PREPARING: 'preparing',
  READY: 'ready',
  SERVED: 'served',
});

export const TICKET_STATUS_VALUES = Object.freeze(Object.values(TICKET_STATUS));

/**
 * Kitchen board is strictly forward-only, one step at a time.
 * Phase 8 reads NEXT_TICKET_STATUS rather than trusting a client-supplied
 * target status, so a ticket can never skip from pending straight to served.
 */
export const NEXT_TICKET_STATUS = Object.freeze({
  [TICKET_STATUS.PENDING]: TICKET_STATUS.PREPARING,
  [TICKET_STATUS.PREPARING]: TICKET_STATUS.READY,
  [TICKET_STATUS.READY]: TICKET_STATUS.SERVED,
  [TICKET_STATUS.SERVED]: null,
});

// --- Expenses --------------------------------------------------------------
export const EXPENSE_CATEGORY = Object.freeze({
  INGREDIENTS: 'Ingredients',
  UTILITIES: 'Utilities',
  SALARY: 'Salary',
  RENT: 'Rent',
  OTHER: 'Other',
});

export const EXPENSE_CATEGORY_VALUES = Object.freeze(Object.values(EXPENSE_CATEGORY));

// --- Attendance ------------------------------------------------------------
export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'present',
  ABSENT: 'absent',
  HALF_DAY: 'half_day',
  LEAVE: 'leave',
});

export const ATTENDANCE_STATUS_VALUES = Object.freeze(Object.values(ATTENDANCE_STATUS));

/**
 * The fraction of a day's pay each status earns. The single source of payroll
 * truth — `computePayroll` reads nothing else to decide what a day is worth.
 *
 * It lives here, beside the statuses rather than in the payroll module, so that
 * adding a status without deciding what it pays is a visible omission rather
 * than a silent zero. A missing entry means a staff member is quietly not paid
 * for those days, which surfaces as a wrong wage weeks later; enums.test.mjs
 * asserts every status has a factor for exactly that reason.
 *
 * LEAVE pays in full: approved leave is time off, not a deduction. An
 * unapproved absence is ABSENT.
 */
export const ATTENDANCE_PAY_FACTOR = Object.freeze({
  [ATTENDANCE_STATUS.PRESENT]: 1,
  [ATTENDANCE_STATUS.ABSENT]: 0,
  [ATTENDANCE_STATUS.HALF_DAY]: 0.5,
  [ATTENDANCE_STATUS.LEAVE]: 1,
});

// --- Payroll ---------------------------------------------------------------
/**
 * `draft` recomputes from attendance on every read; `paid` is frozen against a
 * stored snapshot and no longer moves. See models/Payroll.js.
 */
export const PAYROLL_STATUS = Object.freeze({
  DRAFT: 'draft',
  PAID: 'paid',
});

export const PAYROLL_STATUS_VALUES = Object.freeze(Object.values(PAYROLL_STATUS));

// --- Audit log -------------------------------------------------------------
export const AUDIT_ACTION = Object.freeze({
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',

  /*
   * An account's password was discarded because a verified Google identity
   * claimed the same address.
   *
   * Its own action, not a variant of a login: it is a credential being
   * destroyed, and it happens without the account holder asking for it. If
   * anyone ever asks "why did my password stop working", this is the answer,
   * and it needs to be findable.
   */
  PASSWORD_RETIRED: 'auth.password.retired',
  ACCOUNT_LOCKED: 'auth.account.locked',

  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_ROLE_CHANGE: 'user.role.change',
  USER_DEACTIVATE: 'user.deactivate',

  MENU_ITEM_CREATE: 'menu.item.create',
  MENU_ITEM_UPDATE: 'menu.item.update',
  MENU_ITEM_PRICE_CHANGE: 'menu.item.price.change',
  MENU_ITEM_DELETE: 'menu.item.delete',
  // Irreversible removal of the row itself, only ever possible for an item
  // that never appeared on an order. Recorded separately from the soft delete
  // because the audit entry is the only trace left once the row is gone.
  MENU_ITEM_PURGE: 'menu.item.purge',
  MENU_STOCK_TOGGLE: 'menu.item.stock.toggle',

  TABLE_CREATE: 'table.create',
  TABLE_UPDATE: 'table.update',
  TABLE_DELETE: 'table.delete',

  ORDER_CREATE: 'order.create',
  ORDER_PAY: 'order.pay',
  ORDER_VOID: 'order.void',
  // Irreversible. Once the order row is gone this entry is the only surviving
  // evidence that the sale happened, so it carries a full snapshot rather than
  // an id that resolves to nothing.
  ORDER_DELETE: 'order.delete',
  ORDER_DISCOUNT_APPLIED: 'order.discount.applied',
  ORDER_DISCOUNT_OVERRIDE: 'order.discount.override',

  TICKET_ADVANCE: 'ticket.advance',

  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_UPDATE: 'customer.update',
  CUSTOMER_DELETE: 'customer.delete',

  EXPENSE_CREATE: 'expense.create',
  EXPENSE_DELETE: 'expense.delete',

  // Recorded once per submitted day, not once per employee — a restaurant with
  // twenty staff would otherwise push twenty entries into the trail every
  // morning and bury everything else.
  ATTENDANCE_MARK: 'attendance.mark',
  ATTENDANCE_UPDATE: 'attendance.update',

  PAYROLL_ADJUST: 'payroll.adjust',
  PAYROLL_PAID: 'payroll.paid',
  // Reopening a paid month is the one action here that rewrites a settled
  // figure, so it is recorded apart from the adjustment that follows it.
  PAYROLL_UNPAID: 'payroll.unpaid',

  // Receipt layout, printers and the business details printed on a bill.
  SETTINGS_UPDATE: 'settings.update',

  // A new restaurant was created by someone signing in with Google.
  TENANT_CREATE: 'tenant.create',

  // A terminal was linked to a restaurant, or unlinked from it. Both matter:
  // a linked device is what lets staff PINs be matched at all.
  DEVICE_LINK: 'device.link',
  DEVICE_UNLINK: 'device.unlink',

  /*
   * An existing terminal was re-bound to a different browser.
   *
   * Recorded separately from DEVICE_LINK because the consequence is different:
   * a link grants a new machine the ability to resolve this restaurant, while
   * a RE-link also revokes that ability from whichever machine held it before.
   * A trail that called both "linked" would hide the revocation.
   */
  DEVICE_RELINK: 'device.relink',
  DEVICE_RENAME: 'device.rename',
});

export const AUDIT_ACTION_VALUES = Object.freeze(Object.values(AUDIT_ACTION));
