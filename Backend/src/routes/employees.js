/**
 * Employee routes. Every one of them is `user:manage`, which only admin holds.
 *
 * The permission is applied router-wide rather than per route because there is
 * no read here that a cashier should have: the roster carries salaries, and
 * "who else works here and what do they earn" is the owner's business. A
 * cashier guessing these URLs gets a 403, not a filtered list.
 *
 * Note what is NOT here: no login, and no way to set an administrator's
 * password. Admin accounts authenticate with email and password and are
 * created out of band (src/scripts/seed.js); these endpoints only ever mint
 * PIN-based staff logins. See validators/employees.js for why that is enforced
 * at the schema.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  setPinSchema,
  setActiveSchema,
  listEmployeesSchema,
  idParamSchema,
} from '../validators/employees.js';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  setEmployeePin,
  setEmployeeActive,
  deleteEmployee,
} from '../controllers/employeeController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.USER_MANAGE));

router.get('/', validate({ query: listEmployeesSchema }), listEmployees);
router.post('/', validate({ body: createEmployeeSchema }), createEmployee);

router.get('/:id', validate({ params: idParamSchema }), getEmployee);
router.put(
  '/:id',
  validate({ params: idParamSchema, body: updateEmployeeSchema }),
  updateEmployee,
);

/**
 * Credential and status changes get their own routes rather than riding along
 * inside the edit body, so each is audited as the distinct act it is.
 */
router.patch(
  '/:id/pin',
  validate({ params: idParamSchema, body: setPinSchema }),
  setEmployeePin,
);
router.patch(
  '/:id/active',
  validate({ params: idParamSchema, body: setActiveSchema }),
  setEmployeeActive,
);

router.delete('/:id', validate({ params: idParamSchema }), deleteEmployee);

export default router;
