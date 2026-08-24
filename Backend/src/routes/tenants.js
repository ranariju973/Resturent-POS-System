/**
 * Restaurant routes.
 *
 * ── POST / is the one authenticated route with no permission ───────────────
 * Every other route in this app names a permission. This one cannot: it is
 * reached by a Google account that has authenticated but does not yet belong
 * to a restaurant, and permissions are derived from a role within one. There
 * is nothing for it to hold yet.
 *
 * What stands in place of a permission is the handler's own check that the
 * account has no restaurant, which makes this callable exactly once per
 * account. route-coverage.test.mjs carries a matching exemption.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createTenantSchema, updateTenantSchema } from '../validators/tenants.js';
import { emptyQuerySchema } from '../validators/devices.js';
import {
  createTenant,
  getCurrentTenant,
  updateCurrentTenant,
} from '../controllers/tenantController.js';

const router = Router();

router.use(requireAuth());

/** Onboarding: name a restaurant and become its administrator. */
router.post(
  '/',
  validate({ body: createTenantSchema }),
  createTenant,
);

/** The signed-in user's restaurant. */
router.get(
  '/current',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ query: emptyQuerySchema }),
  getCurrentTenant,
);

/** Edit the identity printed on a customer's receipt. */
router.put(
  '/current',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: updateTenantSchema }),
  updateCurrentTenant,
);

export default router;
