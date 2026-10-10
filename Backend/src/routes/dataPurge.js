/**
 * Data purge routes. Every one is `data:purge`, which only admin holds.
 *
 * POST rather than DELETE, because this is not addressing a specific resource
 * by id — it is a command, and the body carries the confirmation.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { purgeConfirmSchema } from '../validators/dataPurge.js';
import {
  purgeMenu,
  purgeTables,
  purgeKitchen,
  purgeCustomers,
  purgeReports,
} from '../controllers/dataPurgeController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.DATA_PURGE));

router.post('/menu',      validate({ body: purgeConfirmSchema }), purgeMenu);
router.post('/tables',    validate({ body: purgeConfirmSchema }), purgeTables);
router.post('/kitchen',   validate({ body: purgeConfirmSchema }), purgeKitchen);
router.post('/customers', validate({ body: purgeConfirmSchema }), purgeCustomers);
router.post('/reports',   validate({ body: purgeConfirmSchema }), purgeReports);

export default router;
