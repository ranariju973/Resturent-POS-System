/**
 * The user shapes the client is allowed to see.
 *
 * Lives here rather than in a controller because two of them now need it —
 * authController for the session payload, employeeController for the staff
 * roster — and two copies of "which fields may leave the server" is how the
 * two quietly drift until one of them starts leaking a hash.
 */
import { ROLE_LABELS } from '../constants/enums.js';
import { permissionsFor, dashboardScopeFor } from '../constants/permissions.js';
import { toMajor } from './money.js';

/**
 * The signed-in user, as the session sees itself.
 *
 * `permissions` is included so the UI can hide what it must not offer — a
 * cashier should not see a Reports tab that 403s when clicked.
 *
 * It is a CONVENIENCE, not a control. Every route re-checks server-side
 * against the role stored in the database, so a client that edits this list
 * in memory gains exactly nothing: it just gets a 403 from the route it then
 * tries to call. The list is derived from the role, never sent by the client,
 * and never read back as input.
 */
export const publicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  role: user.role,
  roleLabel: ROLE_LABELS[user.role] ?? user.role,
  email: user.email ?? null,
  avatarUrl: user.avatarUrl ?? '',
  lastLoginAt: user.lastLoginAt ?? null,
  permissions: permissionsFor(user.role),
  dashboardScope: dashboardScopeFor(user.role),
});

/**
 * A staff member as the Employees screen sees them: the session shape plus the
 * employment record.
 *
 * `hasPin` is a boolean, deliberately. The admin needs to know whether this
 * person can log in at all; they must never be shown the PIN itself, which is
 * why `pinLookup` is only ever tested for presence and never returned. It is
 * `select: false`, so this reads `false` unless the caller explicitly asked
 * for the field — which the list endpoint does.
 */
export const publicEmployee = (user) => ({
  ...publicUser(user),
  phone: user.phone ?? '',
  joinedOn: user.joinedOn ?? null,
  monthlySalaryMinor: user.monthlySalaryMinor ?? 0,
  monthlySalary: toMajor(user.monthlySalaryMinor ?? 0),
  employmentNotes: user.employmentNotes ?? '',
  isActive: user.isActive,
  hasPin: Boolean(user.pinLookup),
  createdAt: user.createdAt,
});

export default { publicUser, publicEmployee };
