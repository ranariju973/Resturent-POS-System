/**
 * Payroll routes. Every one of them is `user:manage`, which only admin holds.
 *
 * Rows are addressed by (employeeId, month) rather than by a payroll id,
 * because for most months no document exists yet — an untouched month is
 * computed on the fly. Addressing by id would mean an admin could only adjust
 * the months they had already adjusted.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  payrollMonthSchema,
  payrollKeyParamsSchema,
  adjustPayrollSchema,
  markPaidSchema,
} from '../validators/payroll.js';
import {
  getPayroll,
  adjustPayroll,
  markPayrollPaid,
  unmarkPayrollPaid,
} from '../controllers/payrollController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.USER_MANAGE));

router.get('/', validate({ query: payrollMonthSchema }), getPayroll);

router.patch(
  '/:employeeId/:month',
  validate({ params: payrollKeyParamsSchema, body: adjustPayrollSchema }),
  adjustPayroll,
);

/**
 * Settling and reopening are POSTs to their own paths rather than a status
 * field on the PATCH above: paying is not an edit, it freezes the month, and
 * reopening one is the only action here that unmakes a settled figure.
 */
router.post(
  '/:employeeId/:month/pay',
  validate({ params: payrollKeyParamsSchema, body: markPaidSchema }),
  markPayrollPaid,
);
router.post(
  '/:employeeId/:month/unpay',
  validate({ params: payrollKeyParamsSchema }),
  unmarkPayrollPaid,
);

export default router;
