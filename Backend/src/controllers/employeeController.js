/**
 * Employee (staff account) handlers. Admin only — `user:manage`.
 *
 * These write to the same `User` documents that authenticate at the terminal,
 * so every operation here is a credential operation whether it looks like one
 * or not: adding an employee mints a login, changing a role changes what that
 * login may do, and deactivating one must end the session already in progress.
 *
 * ── The three things this file is careful about ────────────────────────────
 *   1. PIN collisions. `pinLookup` is globally unique and the admin now types
 *      the digits, so clashes are routine rather than exceptional. See
 *      savePinnedUser.
 *   2. Self-harm. An admin who deletes, demotes or deactivates their own
 *      account can lock every person out of the system with no way back. See
 *      assertNotSelf / assertAnotherAdminRemains.
 *   3. Dangling references. Orders point at the staff member who rang them up.
 *      See assertEmployeeUnreferenced.
 */
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, ROLE_VALUES, PIN_ROLES } from '../constants/enums.js';
import { PERMISSIONS, hasPermission } from '../constants/permissions.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { publicUser, publicEmployee } from '../utils/publicUser.js';
import { assertEmployeeUnreferenced } from '../utils/referenceGuard.js';
import { escapeRegex } from '../models/Customer.js';
import { logger } from '../utils/logger.js';

/**
 * Roles that can administer the system, derived from the permission map rather
 * than written out as a literal.
 *
 * Two reasons. It stays correct if a second administering role is ever added,
 * and — less obviously — a direct `role === 'admin'` comparison anywhere in a
 * controller fails the build (tests/route-coverage.test.mjs §5). The permission
 * map is the only place a role is allowed to mean something.
 */
const ADMIN_ROLES = ROLE_VALUES.filter((role) => hasPermission(role, PERMISSIONS.USER_MANAGE));

const PIN_TAKEN_MESSAGE =
  'That PIN is already in use by another employee. Choose a different four digits.';

/** Fields the roster needs that are select:false by default. */
const ROSTER_FIELDS = '+pinLookup';

/**
 * Persist a user whose PIN was just set, turning the unique-index violation
 * into something the admin can act on.
 *
 * ── Why the pre-check in User.pinTaken is not enough ───────────────────────
 * That check and this save are two round trips. Two admins adding staff at the
 * same moment both pass the check and one of them loses at write time, so the
 * duplicate-key error is ordinary control flow here, not an exceptional case.
 *
 * ── Why this cannot be left to the global error handler ────────────────────
 * errorHandler.js already turns 11000 into a 409, but it names the offending
 * field: "A record with that pinLookup already exists". That leaks an internal
 * column name and tells the admin nothing about what to do. Catching it here is
 * what keeps the message about PINs.
 *
 * Scoped to `pinLookup` specifically — a duplicate `email` on the same document
 * is a different mistake and must not be reported as a PIN clash.
 */
async function savePinnedUser(user) {
  try {
    return await user.save();
  } catch (err) {
    if (err?.code === 11000 && 'pinLookup' in (err.keyPattern ?? err.keyValue ?? {})) {
      throw ApiError.conflict(PIN_TAKEN_MESSAGE);
    }
    throw err;
  }
}

/**
 * An admin may not act destructively on their own account.
 *
 * Not a matter of taste. The one realistic way to lock every person out of this
 * system is for the only admin to delete or demote themselves late on a Friday:
 * there is no password-reset flow and no second admin to undo it, so recovery
 * means someone editing MongoDB by hand.
 *
 * Compares ids, never roles.
 */
function assertNotSelf(req, targetId, action) {
  if (String(targetId) === String(req.user.id)) {
    throw ApiError.conflict(`You cannot ${action} your own account.`);
  }
}

/**
 * Refuse an operation that would leave the system with no active administrator.
 *
 * Separate from assertNotSelf, and not covered by it: with two admins, one
 * deactivating the OTHER is allowed by every self-check and still empties the
 * chair if the first is already inactive.
 */
async function assertAnotherAdminRemains(targetId) {
  const others = await User.countDocuments({
    // trusted() because sanitizeFilter is enabled globally (src/config/db.js).
    _id: mongoose.trusted({ $ne: targetId }),
    role: mongoose.trusted({ $in: [...ADMIN_ROLES] }),
    isActive: true,
  });

  if (others === 0) {
    throw ApiError.conflict(
      'This is the last active administrator. Add another admin before removing this one.',
    );
  }
}

/** Load a staff record, or 404. */
async function loadEmployee(id) {
  const employee = await User.findById(id).select(ROSTER_FIELDS);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

// ---------------------------------------------------------------------------
// GET /api/employees
// ---------------------------------------------------------------------------
export const listEmployees = asyncHandler(async (req, res) => {
  const { role, includeInactive, search, limit, skip } = req.query;

  // Admins are included: the roster is "everyone with an account", and hiding
  // the owner from their own staff list is confusing rather than protective.
  const filter = {};
  if (role) filter.role = role;
  if (includeInactive !== 'true') filter.isActive = true;

  if (search) {
    // Escaped before interpolation — an unescaped search term is a ReDoS.
    filter.name = mongoose.trusted({ $regex: escapeRegex(search), $options: 'i' });
  }

  const [employees, total] = await Promise.all([
    User.find(filter).select(ROSTER_FIELDS).sort({ name: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return sendSuccess(res, { employees: employees.map(publicEmployee), total });
});

// ---------------------------------------------------------------------------
// GET /api/employees/:id
// ---------------------------------------------------------------------------
export const getEmployee = asyncHandler(async (req, res) => {
  const employee = await loadEmployee(req.params.id);
  return sendSuccess(res, { employee: publicEmployee(employee) });
});

// ---------------------------------------------------------------------------
// POST /api/employees
// ---------------------------------------------------------------------------
/**
 * Create a staff account.
 *
 * The role is restricted to PIN_ROLES by the schema, so this only ever mints a
 * cashier or kitchen-staff login. The PIN is set through `setPin()` — never
 * assigned directly — because that is what derives both the bcrypt hash and the
 * lookup HMAC.
 */
export const createEmployee = asyncHandler(async (req, res) => {
  const { name, role, pin, phone, joinedOn, monthlySalaryMinor, employmentNotes } = req.body;

  // The courtesy check. Cheap, and it means the common case gets a clear answer
  // while the form is still open rather than a save that fails obscurely.
  if (await User.pinTaken(pin)) throw ApiError.conflict(PIN_TAKEN_MESSAGE);

  const employee = new User({
    name,
    role,
    phone,
    joinedOn: joinedOn ? new Date(`${joinedOn}T00:00:00.000Z`) : null,
    monthlySalaryMinor,
    employmentNotes,
    isActive: true,
  });

  await employee.setPin(pin);
  await savePinnedUser(employee);

  await AuditLog.record(
    {
      action: AUDIT_ACTION.USER_CREATE,
      resource: 'User',
      resourceId: employee._id,
      // No PIN, and no phone. The trail records that an account was created and
      // with what role — the credential itself has no business being here, and
      // AuditLog's redaction list would strip it anyway.
      meta: { role: employee.role },
    },
    req,
  );

  return sendSuccess(res, { employee: publicEmployee(employee) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// PUT /api/employees/:id
// ---------------------------------------------------------------------------
/**
 * Edit a staff record, including role reassignment.
 *
 * A role change is audited separately from the rest of the edit — it is the
 * one field here that changes what the account may DO, and burying it inside a
 * generic "user.update" would make it invisible in the trail.
 */
export const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await loadEmployee(req.params.id);

  const previousRole = employee.role;
  const roleChanging = req.body.role !== undefined && req.body.role !== previousRole;

  if (roleChanging) {
    assertNotSelf(req, employee._id, 'change the role of');
    // Demoting the last admin is the same lockout as deleting them.
    if (ADMIN_ROLES.includes(previousRole)) await assertAnotherAdminRemains(employee._id);
  }

  const { joinedOn, ...rest } = req.body;
  Object.assign(employee, rest);
  if (joinedOn !== undefined) employee.joinedOn = new Date(`${joinedOn}T00:00:00.000Z`);

  await employee.save();

  if (roleChanging) {
    // The refresh token carries the role it was minted with, so rotate the
    // session rather than leaving a stale claim in circulation. requireAuth
    // reads the role from the database on every request, so the new
    // permissions apply immediately either way — this closes the token itself.
    await employee.revokeTokens();

    await AuditLog.record(
      {
        action: AUDIT_ACTION.USER_ROLE_CHANGE,
        resource: 'User',
        resourceId: employee._id,
        meta: { from: previousRole, to: employee.role },
      },
      req,
    );
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.USER_UPDATE,
      resource: 'User',
      resourceId: employee._id,
      // Field NAMES only — the values are personal data and have no business here.
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { employee: publicEmployee(employee) });
});

// ---------------------------------------------------------------------------
// PATCH /api/employees/:id/pin
// ---------------------------------------------------------------------------
/**
 * Set or replace a staff member's login PIN.
 *
 * Its own endpoint rather than a field on the edit form: this is a credential
 * change and should be recorded as one, not smuggled in beside a name
 * correction.
 *
 * The response never echoes the PIN. The admin typed it and knows it; sending
 * it back would put it in a response body, a browser cache and possibly a log
 * for no benefit at all.
 */
export const setEmployeePin = asyncHandler(async (req, res) => {
  const { pin } = req.body;
  const employee = await loadEmployee(req.params.id);

  if (!PIN_ROLES.includes(employee.role)) {
    throw ApiError.conflict(
      'Only cashier and kitchen staff sign in with a PIN. Administrators use an email and password.',
    );
  }

  // exceptId matters: re-setting somebody's PIN to the value they already hold
  // must not collide with their own row.
  if (await User.pinTaken(pin, employee._id)) throw ApiError.conflict(PIN_TAKEN_MESSAGE);

  await employee.setPin(pin);
  await savePinnedUser(employee);

  // A new PIN means the old one must stop working everywhere, including on a
  // terminal that is still signed in on the previous credential.
  await employee.revokeTokens();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.USER_UPDATE,
      resource: 'User',
      resourceId: employee._id,
      meta: { pinChanged: true },
    },
    req,
  );

  logger.info('Staff PIN changed', {
    requestId: req.id,
    employeeId: String(employee._id),
  });

  return sendSuccess(res, { id: String(employee._id), pinSet: true });
});

// ---------------------------------------------------------------------------
// PATCH /api/employees/:id/active
// ---------------------------------------------------------------------------
/**
 * Activate or deactivate an account.
 *
 * This is the intended way to remove somebody: it is immediate, reversible, and
 * keeps every past order resolving to the person who actually rang it up.
 * Deletion is the exception, not the default.
 *
 * `revokeTokens()` is not optional. requireAuth already re-reads `isActive` on
 * every request and would reject them, but a fired employee is exactly the case
 * where using one control when two are available is careless.
 */
export const setEmployeeActive = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const employee = await loadEmployee(req.params.id);

  if (!isActive) {
    assertNotSelf(req, employee._id, 'deactivate');
    if (ADMIN_ROLES.includes(employee.role)) await assertAnotherAdminRemains(employee._id);
  }

  employee.isActive = isActive;
  await employee.save();
  await employee.revokeTokens();

  await AuditLog.record(
    {
      action: isActive ? AUDIT_ACTION.USER_UPDATE : AUDIT_ACTION.USER_DEACTIVATE,
      resource: 'User',
      resourceId: employee._id,
      meta: { isActive },
    },
    req,
  );

  return sendSuccess(res, { employee: publicEmployee(employee) });
});

// ---------------------------------------------------------------------------
// DELETE /api/employees/:id
// ---------------------------------------------------------------------------
/**
 * Permanently remove a staff account.
 *
 * Guarded, and expected to refuse for anyone who has actually worked a shift —
 * that is not a limitation, it is the point. The realistic use is removing a
 * record created by mistake; for a genuine leaver, deactivation is correct and
 * the 409 says so.
 *
 * Note the PIN goes with the row, freeing those four digits for reuse. A
 * DEACTIVATED employee keeps theirs, so their PIN stays reserved and no later
 * hire can be confused with them in the login trail.
 */
export const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await loadEmployee(req.params.id);

  assertNotSelf(req, employee._id, 'delete');
  if (ADMIN_ROLES.includes(employee.role)) await assertAnotherAdminRemains(employee._id);

  // Payroll is resolved from Mongoose's registry rather than imported, so this
  // controller does not hard-depend on the payroll module existing.
  const Payroll = mongoose.models.Payroll ?? null;
  await assertEmployeeUnreferenced(employee._id, { Payroll });

  // Captured before the row goes: once deleted, the audit entry is the only
  // surviving record that this account existed.
  const snapshot = { name: employee.name, role: employee.role };

  await User.deleteOne({ _id: employee._id });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.USER_DEACTIVATE,
      resource: 'User',
      resourceId: employee._id,
      meta: { ...snapshot, deleted: true },
    },
    req,
  );

  logger.warn('Staff account permanently deleted', {
    requestId: req.id,
    employeeId: String(employee._id),
    role: snapshot.role,
  });

  return sendSuccess(res, { deleted: true, id: String(employee._id) });
});

export default {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  setEmployeePin,
  setEmployeeActive,
  deleteEmployee,
};
