/**
 * Permission catalogue and the role → permission map.
 *
 * This file is the single source of truth for who may do what. Routes name a
 * permission; only this map says which roles hold it. Nothing anywhere else
 * should branch on `role === 'admin'` — that pattern is how a system ends up
 * with authorisation rules scattered across thirty controllers, each subtly
 * different, none of them reviewable together.
 *
 * ── Deny by default ────────────────────────────────────────────────────────
 * A role holds exactly the permissions listed for it. There is no inheritance
 * and no "everything except" list. Allow-lists fail closed: a permission added
 * next month is invisible to cashier and kitchen staff until someone
 * deliberately grants it. A deny-list would silently hand it to everyone.
 */
import { ROLES } from './enums.js';

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const PERMISSIONS = Object.freeze({
  // Dashboard — two distinct grants, not one with a modifier. A cashier must
  // not be able to reach the full payload by any route, so the difference is
  // expressed as separate permissions rather than a flag on one.
  DASHBOARD_VIEW_FULL: 'dashboard:view:full',
  DASHBOARD_VIEW_LIMITED: 'dashboard:view:limited',

  // POS billing
  POS_CREATE_ORDER: 'pos:create_order',
  POS_APPLY_DISCOUNT: 'pos:apply_discount',
  POS_VOID_ORDER: 'pos:void_order',
  POS_OVERRIDE: 'pos:override',
  /**
   * Permanent removal of an order document. Distinct from POS_VOID_ORDER on
   * purpose: voiding keeps the record and is a normal part of service, whereas
   * this destroys it and the day's takings no longer reconcile against what
   * the till actually holds. Granted to admin only, and never added to the
   * cashier list — a cashier who can delete their own orders can take cash and
   * leave nothing behind to notice.
   */
  ORDER_DELETE: 'order:delete',

  // Menu
  MENU_VIEW: 'menu:view',
  MENU_CREATE: 'menu:create',
  MENU_EDIT: 'menu:edit',
  MENU_DELETE: 'menu:delete',
  /** The stock in / sold out toggle — the only menu write a non-admin holds. */
  MENU_TOGGLE_STOCK: 'menu:toggle_stock',

  // Tables
  TABLE_VIEW: 'table:view',
  TABLE_CREATE: 'table:create',
  TABLE_EDIT: 'table:edit',
  TABLE_DELETE: 'table:delete',
  /** Seat, transfer, merge, split — operating the floor, not configuring it. */
  TABLE_MANAGE_SEATING: 'table:manage_seating',

  // Kitchen
  KITCHEN_VIEW: 'kitchen:view',
  KITCHEN_ADVANCE_STATUS: 'kitchen:advance_status',
  /**
   * Move a ticket BACKWARD. Admin only — see the note on Ticket.recall().
   * Advancing is everyone's normal work; reversing rewrites what the line
   * believes about an order that may already be plated.
   */
  KITCHEN_RECALL: 'kitchen:recall',

  // Customers
  CUSTOMER_VIEW: 'customer:view',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_EDIT: 'customer:edit',
  CUSTOMER_DELETE: 'customer:delete',

  // Reports
  REPORTS_VIEW: 'reports:view',

  // Administration
  USER_MANAGE: 'user:manage',
  AUDIT_VIEW: 'audit:view',
});

export const PERMISSION_VALUES = Object.freeze(Object.values(PERMISSIONS));

// ---------------------------------------------------------------------------
// Role map
// ---------------------------------------------------------------------------

const P = PERMISSIONS;

/**
 * Admin holds every permission. Written as the literal list rather than a '*'
 * wildcard so that `permissionsFor('admin')` returns something a client can
 * actually use to build a menu, and so a new permission shows up in admin's
 * set automatically without a wildcard special-case in the check function.
 */
const ADMIN_PERMISSIONS = PERMISSION_VALUES;

/**
 * Cashier — full front-of-house operation, no configuration, no financials.
 *
 * Notably absent:
 *   reports:view    P&L, expenses and margins are the owner's business
 *   menu:*          beyond the stock toggle — a cashier repricing an item is
 *                   an obvious fraud path
 *   table:create/edit/delete   floor plan is configuration, not operation
 *   pos:void_order  see the note on POS_VOID_ORDER below
 */
const CASHIER_PERMISSIONS = [
  P.DASHBOARD_VIEW_LIMITED,

  P.POS_CREATE_ORDER,
  P.POS_APPLY_DISCOUNT,

  P.MENU_VIEW,
  P.MENU_TOGGLE_STOCK,

  P.TABLE_VIEW,
  P.TABLE_MANAGE_SEATING,

  P.KITCHEN_VIEW,
  P.KITCHEN_ADVANCE_STATUS,

  P.CUSTOMER_VIEW,
  P.CUSTOMER_CREATE,
  P.CUSTOMER_EDIT,
  // CUSTOMER_DELETE is deliberately absent. Removing a customer record deletes
  // someone's history and the contact details a refund or a complaint would be
  // traced through; that is an owner's decision, not a tidying-up job for a
  // cashier between orders.
];

/**
 * Kitchen staff — the board, and the one menu control they genuinely need.
 *
 * Marking a dish sold out is a kitchen decision (the walk-in ran out of
 * salmon), so `menu:toggle_stock` belongs here even though every other menu
 * write does not. No dashboard, no POS, no tables, no customers, no reports.
 */
const KITCHEN_PERMISSIONS = [
  P.KITCHEN_VIEW,
  P.KITCHEN_ADVANCE_STATUS,

  P.MENU_VIEW,
  P.MENU_TOGGLE_STOCK,
];

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: Object.freeze([...ADMIN_PERMISSIONS]),
  [ROLES.CASHIER]: Object.freeze([...CASHIER_PERMISSIONS]),
  [ROLES.KITCHEN_STAFF]: Object.freeze([...KITCHEN_PERMISSIONS]),
});

/** Pre-built Sets — permission checks run on every request, so O(1) matters. */
const ROLE_PERMISSION_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, new Set(perms)]),
  ),
);

// ---------------------------------------------------------------------------
// Query helpers — pure, so they can be tested without Express or a database
// ---------------------------------------------------------------------------

/**
 * Does this role hold this permission?
 * Unknown role or unknown permission => false. Never throws, never guesses.
 *
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  const set = ROLE_PERMISSION_SETS[role];
  if (!set) return false;
  return set.has(permission);
}

/** Does this role hold at least one of these permissions? */
export function hasAnyPermission(role, permissions) {
  return permissions.some((p) => hasPermission(role, p));
}

/** Does this role hold all of these permissions? */
export function hasAllPermissions(role, permissions) {
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * Every permission a role holds. Returned to the client from /auth/me so the
 * UI can hide what it must not offer.
 *
 * This is a CONVENIENCE, not a control. The client receiving this list changes
 * nothing about enforcement — every route still checks server-side. A client
 * that lies about its permissions gets a 403 from the route it tries to call.
 *
 * @param {string} role
 * @returns {string[]}
 */
export function permissionsFor(role) {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/**
 * Which dashboard payload this role gets.
 * Phase 10 shapes the response on this rather than on the role directly.
 *
 * @param {string} role
 * @returns {'full'|'limited'|null}
 */
export function dashboardScopeFor(role) {
  if (hasPermission(role, PERMISSIONS.DASHBOARD_VIEW_FULL)) return 'full';
  if (hasPermission(role, PERMISSIONS.DASHBOARD_VIEW_LIMITED)) return 'limited';
  return null;
}

export default {
  PERMISSIONS,
  PERMISSION_VALUES,
  ROLE_PERMISSIONS,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  permissionsFor,
  dashboardScopeFor,
};
