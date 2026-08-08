/**
 * Settings routes. Every one is `settings:manage`, which only admin holds.
 *
 * No public route may ever be added to this file: route-coverage decides
 * whether a route is authenticated by testing the WHOLE FILE for
 * `router.use(requireAuth())`, so a public route sitting here would be
 * credited with auth it does not have.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  printerSettingsQuerySchema,
  updatePrinterSettingsSchema,
} from '../validators/settings.js';
import {
  getPrinterSettings,
  updatePrinterSettings,
} from '../controllers/settingsController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.SETTINGS_MANAGE));

router.get(
  '/printer',
  validate({ query: printerSettingsQuerySchema }),
  getPrinterSettings,
);

router.put(
  '/printer',
  validate({ body: updatePrinterSettingsSchema }),
  updatePrinterSettings,
);

export default router;
