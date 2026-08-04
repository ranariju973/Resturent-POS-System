/**
 * Dashboard route.
 *
 * Reachable with EITHER dashboard grant; the controller shapes the payload
 * from `dashboardScopeFor(role)`. One endpoint rather than two means the
 * cashier and admin views cannot drift apart over time — and the shaping
 * decision lives in exactly one place.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { dashboardSchema } from '../validators/reports.js';
import { getDashboard } from '../controllers/dashboardController.js';

const router = Router();

router.use(requireAuth());

router.get(
  '/',
  requireAnyPermission([PERMISSIONS.DASHBOARD_VIEW_FULL, PERMISSIONS.DASHBOARD_VIEW_LIMITED]),
  // `.strict()` on an empty object: any query parameter at all is a 400, so
  // `?range=month` cannot quietly become a way to widen the cashier's view.
  validate({ query: dashboardSchema }),
  getDashboard,
);

export default router;
