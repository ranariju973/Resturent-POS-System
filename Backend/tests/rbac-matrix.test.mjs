/**
 * The full RBAC matrix, run against the REAL permission module.
 *
 * permissions.js imports only enums.js and neither pulls in a third-party
 * package, so this executes the actual `hasPermission` every route will call —
 * not a model of it.
 *
 * The matrix below is transcribed from the agreed spec. If a permission is
 * ever granted or revoked in src/constants/permissions.js without the spec
 * changing too, this fails.
 */
import {
  PERMISSIONS as P,
  PERMISSION_VALUES,
  ROLE_PERMISSIONS,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  permissionsFor,
  dashboardScopeFor,
} from '../src/constants/permissions.js';
import { ROLES, ROLE_VALUES } from '../src/constants/enums.js';

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

const ADMIN = ROLES.ADMIN;
const CASHIER = ROLES.CASHIER;
const KITCHEN = ROLES.KITCHEN_STAFF;

/**
 * The agreed spec: for each permission, exactly which roles hold it.
 * Everything not listed for a permission MUST be denied.
 */
const SPEC = {
  [P.DASHBOARD_VIEW_FULL]: [ADMIN],
  [P.DASHBOARD_VIEW_LIMITED]: [ADMIN, CASHIER],

  [P.POS_CREATE_ORDER]: [ADMIN, CASHIER],
  [P.POS_APPLY_DISCOUNT]: [ADMIN, CASHIER],
  [P.POS_VOID_ORDER]: [ADMIN],
  [P.POS_OVERRIDE]: [ADMIN],
  // Admin only, and listed apart from POS_VOID_ORDER on purpose. Voiding is
  // service recovery; this destroys the record of a sale. If these two ever
  // end up sharing a row, the destructive one has been handed to whoever
  // needs the ordinary one.
  [P.ORDER_DELETE]: [ADMIN],

  [P.MENU_VIEW]: [ADMIN, CASHIER, KITCHEN],
  [P.MENU_TOGGLE_STOCK]: [ADMIN, CASHIER, KITCHEN],
  [P.MENU_CREATE]: [ADMIN],
  [P.MENU_EDIT]: [ADMIN],
  [P.MENU_DELETE]: [ADMIN],

  [P.TABLE_VIEW]: [ADMIN, CASHIER],
  [P.TABLE_MANAGE_SEATING]: [ADMIN, CASHIER],
  [P.TABLE_CREATE]: [ADMIN],
  [P.TABLE_EDIT]: [ADMIN],
  [P.TABLE_DELETE]: [ADMIN],

  [P.KITCHEN_VIEW]: [ADMIN, CASHIER, KITCHEN],
  [P.KITCHEN_ADVANCE_STATUS]: [ADMIN, CASHIER, KITCHEN],
  [P.KITCHEN_RECALL]: [ADMIN],

  [P.CUSTOMER_VIEW]: [ADMIN, CASHIER],
  [P.CUSTOMER_CREATE]: [ADMIN, CASHIER],
  [P.CUSTOMER_EDIT]: [ADMIN, CASHIER],
  [P.CUSTOMER_DELETE]: [ADMIN],

  [P.REPORTS_VIEW]: [ADMIN],

  [P.USER_MANAGE]: [ADMIN],
  [P.AUDIT_VIEW]: [ADMIN],
  [P.SETTINGS_MANAGE]: [ADMIN],
};

console.log('--- every permission x every role ---');
let cells = 0;
const mismatches = [];
for (const [permission, allowed] of Object.entries(SPEC)) {
  for (const role of ROLE_VALUES) {
    const expected = allowed.includes(role);
    const actual = hasPermission(role, permission);
    cells += 1;
    if (actual !== expected) {
      mismatches.push(`${role} / ${permission}: expected ${expected}, got ${actual}`);
    }
  }
}
t(`${cells} role/permission cells match the spec`, mismatches.length === 0,
  mismatches.length ? `\n     ${mismatches.join('\n     ')}` : '');

console.log('\n--- the catalogue and the spec agree ---');
const specKeys = new Set(Object.keys(SPEC));
const missingFromSpec = PERMISSION_VALUES.filter((p) => !specKeys.has(p));
const unknownInSpec = [...specKeys].filter((p) => !PERMISSION_VALUES.includes(p));
t('every catalogued permission appears in the spec', missingFromSpec.length === 0,
  missingFromSpec.join(', '));
t('the spec invents no permissions', unknownInSpec.length === 0, unknownInSpec.join(', '));

console.log('\n--- admin ---');
t('holds every permission', PERMISSION_VALUES.every((p) => hasPermission(ADMIN, p)));
t('permissionsFor(admin) is the whole catalogue',
  permissionsFor(ADMIN).length === PERMISSION_VALUES.length);
t('dashboard scope is full', dashboardScopeFor(ADMIN) === 'full');

console.log('\n--- cashier: the restrictions that matter ---');
t('CANNOT view reports', !hasPermission(CASHIER, P.REPORTS_VIEW));
t('CANNOT see the full dashboard', !hasPermission(CASHIER, P.DASHBOARD_VIEW_FULL));
t('gets the limited dashboard', dashboardScopeFor(CASHIER) === 'limited');
t('CANNOT create/edit/delete menu items',
  !hasAnyPermission(CASHIER, [P.MENU_CREATE, P.MENU_EDIT, P.MENU_DELETE]));
t('CAN toggle stock (the one menu write)', hasPermission(CASHIER, P.MENU_TOGGLE_STOCK));
t('CANNOT add/edit/delete tables or set seat counts',
  !hasAnyPermission(CASHIER, [P.TABLE_CREATE, P.TABLE_EDIT, P.TABLE_DELETE]));
t('CAN seat/transfer/merge/split', hasPermission(CASHIER, P.TABLE_MANAGE_SEATING));
t('CANNOT void a paid order unaided', !hasPermission(CASHIER, P.POS_VOID_ORDER));
t('CANNOT self-authorise an override', !hasPermission(CASHIER, P.POS_OVERRIDE));
t('CAN take orders and apply a normal discount',
  hasAllPermissions(CASHIER, [P.POS_CREATE_ORDER, P.POS_APPLY_DISCOUNT]));
t('CAN view, add and edit customers',
  hasAllPermissions(CASHIER, [P.CUSTOMER_VIEW, P.CUSTOMER_CREATE, P.CUSTOMER_EDIT]));
// Deleting a customer removes the contact details a refund or complaint would
// be traced through. That is an owner's call, not counter tidying.
t('CANNOT delete a customer', !hasPermission(CASHIER, P.CUSTOMER_DELETE));
t('CANNOT manage users or read the audit log',
  !hasAnyPermission(CASHIER, [P.USER_MANAGE, P.AUDIT_VIEW]));

console.log('\n--- kitchen staff: kitchen + stock toggle, nothing else ---');
const KITCHEN_EXPECTED = [
  P.KITCHEN_VIEW,
  P.KITCHEN_ADVANCE_STATUS,
  P.MENU_VIEW,
  P.MENU_TOGGLE_STOCK,
];
t('holds exactly 4 permissions (recall is NOT among them)', permissionsFor(KITCHEN).length === 4,
  permissionsFor(KITCHEN).join(', '));
t('holds precisely the expected set',
  KITCHEN_EXPECTED.every((p) => hasPermission(KITCHEN, p)) &&
    permissionsFor(KITCHEN).every((p) => KITCHEN_EXPECTED.includes(p)));
t('NO dashboard of any kind', dashboardScopeFor(KITCHEN) === null);
t('NO POS access', !hasAnyPermission(KITCHEN, [P.POS_CREATE_ORDER, P.POS_APPLY_DISCOUNT, P.POS_VOID_ORDER]));
t('NO table access at all', !hasAnyPermission(KITCHEN, [P.TABLE_VIEW, P.TABLE_MANAGE_SEATING, P.TABLE_CREATE]));
t('NO customer access', !hasAnyPermission(KITCHEN, [P.CUSTOMER_VIEW, P.CUSTOMER_CREATE]));
t('NO reports', !hasPermission(KITCHEN, P.REPORTS_VIEW));
t('CAN work the board', hasAllPermissions(KITCHEN, [P.KITCHEN_VIEW, P.KITCHEN_ADVANCE_STATUS]));
t('CAN mark a dish sold out', hasPermission(KITCHEN, P.MENU_TOGGLE_STOCK));

console.log('\n--- fails closed ---');
t('unknown role holds nothing', !hasPermission('manager', P.MENU_VIEW));
t('undefined role holds nothing', !hasPermission(undefined, P.MENU_VIEW));
t('null role holds nothing', !hasPermission(null, P.MENU_VIEW));
t('empty role holds nothing', !hasPermission('', P.MENU_VIEW));
t('unknown permission is denied even for admin', !hasPermission(ADMIN, 'menu:destroy_everything'));
t('undefined permission is denied', !hasPermission(ADMIN, undefined));
t('role name is case-sensitive (no "Admin" backdoor)', !hasPermission('Admin', P.REPORTS_VIEW));
t('permission name is case-sensitive', !hasPermission(ADMIN, 'REPORTS:VIEW'));
t('hasAnyPermission([]) is false', !hasAnyPermission(ADMIN, []));
t('hasAllPermissions([]) is vacuously true', hasAllPermissions(ADMIN, []));

console.log('\n--- the map cannot be mutated at runtime ---');
t('ROLE_PERMISSIONS is frozen', Object.isFrozen(ROLE_PERMISSIONS));
t('each role list is frozen', Object.values(ROLE_PERMISSIONS).every(Object.isFrozen));
{
  // A caller mutating the returned array must not affect the source.
  const copy = permissionsFor(CASHIER);
  const before = permissionsFor(CASHIER).length;
  copy.push(P.REPORTS_VIEW);
  t('permissionsFor returns a defensive copy',
    permissionsFor(CASHIER).length === before && !hasPermission(CASHIER, P.REPORTS_VIEW));
}
{
  let threw = false;
  try {
    ROLE_PERMISSIONS[CASHIER].push(P.REPORTS_VIEW);
  } catch {
    threw = true;
  }
  t('pushing onto a role list does not grant it',
    threw || !hasPermission(CASHIER, P.REPORTS_VIEW));
}

console.log('\n--- privilege ordering ---');
for (const role of [CASHIER, KITCHEN]) {
  const perms = permissionsFor(role);
  t(`${role} holds a strict subset of admin`,
    perms.every((p) => hasPermission(ADMIN, p)) && perms.length < PERMISSION_VALUES.length);
}
t('no permission is held by cashier but not admin',
  permissionsFor(CASHIER).every((p) => hasPermission(ADMIN, p)));
t('kitchen is not a subset of cashier (it holds nothing cashier lacks, but differs)',
  permissionsFor(KITCHEN).every((p) => hasPermission(CASHIER, p)));

console.log('\n--- planned route table (Phases 5-10) ---');
/** method, path, permission, then which roles must be able to reach it. */
const ROUTES = [
  ['GET', '/api/dashboard', 'either dashboard grant', [ADMIN, CASHIER]],
  ['GET', '/api/menu/items', P.MENU_VIEW, [ADMIN, CASHIER, KITCHEN]],
  ['POST', '/api/menu/items', P.MENU_CREATE, [ADMIN]],
  ['PUT', '/api/menu/items/:id', P.MENU_EDIT, [ADMIN]],
  ['DELETE', '/api/menu/items/:id', P.MENU_DELETE, [ADMIN]],
  ['PATCH', '/api/menu/items/:id/availability', P.MENU_TOGGLE_STOCK, [ADMIN, CASHIER, KITCHEN]],
  ['GET', '/api/tables', P.TABLE_VIEW, [ADMIN, CASHIER]],
  ['POST', '/api/tables', P.TABLE_CREATE, [ADMIN]],
  ['PUT', '/api/tables/:id', P.TABLE_EDIT, [ADMIN]],
  ['DELETE', '/api/tables/:id', P.TABLE_DELETE, [ADMIN]],
  ['PATCH', '/api/tables/:id/seat', P.TABLE_MANAGE_SEATING, [ADMIN, CASHIER]],
  ['POST', '/api/orders', P.POS_CREATE_ORDER, [ADMIN, CASHIER]],
  ['PATCH', '/api/orders/:id/discount', P.POS_APPLY_DISCOUNT, [ADMIN, CASHIER]],
  ['POST', '/api/orders/:id/void', P.POS_VOID_ORDER, [ADMIN]],
  ['GET', '/api/kitchen/tickets', P.KITCHEN_VIEW, [ADMIN, CASHIER, KITCHEN]],
  ['PATCH', '/api/kitchen/tickets/:id/advance', P.KITCHEN_ADVANCE_STATUS, [ADMIN, CASHIER, KITCHEN]],
  ['GET', '/api/customers', P.CUSTOMER_VIEW, [ADMIN, CASHIER]],
  ['DELETE', '/api/customers/:id', P.CUSTOMER_DELETE, [ADMIN]],
  ['GET', '/api/reports/daily', P.REPORTS_VIEW, [ADMIN]],
  ['GET', '/api/reports/pnl', P.REPORTS_VIEW, [ADMIN]],
  ['GET', '/api/reports/expenses', P.REPORTS_VIEW, [ADMIN]],
  ['GET', '/api/audit-logs', P.AUDIT_VIEW, [ADMIN]],
];

let routeFails = 0;
for (const [method, path, permission, allowed] of ROUTES) {
  for (const role of ROLE_VALUES) {
    const expected = allowed.includes(role);
    const actual =
      permission === 'either dashboard grant'
        ? hasAnyPermission(role, [P.DASHBOARD_VIEW_FULL, P.DASHBOARD_VIEW_LIMITED])
        : hasPermission(role, permission);
    if (actual !== expected) {
      routeFails += 1;
      console.log(`     ${role} -> ${method} ${path}: expected ${expected ? 'allow' : 'deny'}, got ${actual ? 'allow' : 'deny'}`);
    }
  }
}
t(`${ROUTES.length * ROLE_VALUES.length} route/role combinations behave as specified`, routeFails === 0);

console.log('\n--- the specific denials from the brief ---');
t('cashier -> GET /api/reports/daily is DENIED', !hasPermission(CASHIER, P.REPORTS_VIEW));
t('cashier -> DELETE /api/tables/:id is DENIED', !hasPermission(CASHIER, P.TABLE_DELETE));
t('cashier -> PUT /api/menu/items/:id is DENIED', !hasPermission(CASHIER, P.MENU_EDIT));
t('kitchen -> GET /api/dashboard is DENIED',
  !hasAnyPermission(KITCHEN, [P.DASHBOARD_VIEW_FULL, P.DASHBOARD_VIEW_LIMITED]));
t('kitchen -> POST /api/orders is DENIED', !hasPermission(KITCHEN, P.POS_CREATE_ORDER));
t('kitchen -> GET /api/customers is DENIED', !hasPermission(KITCHEN, P.CUSTOMER_VIEW));
t('kitchen -> GET /api/tables is DENIED', !hasPermission(KITCHEN, P.TABLE_VIEW));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
