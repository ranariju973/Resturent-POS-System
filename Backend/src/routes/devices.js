/**
 * Terminal routes. Admin only.
 *
 * Linking a terminal is what lets staff sign in with a PIN at all — the device
 * cookie is how the server resolves which restaurant four digits belong to.
 * That makes it a `user:manage` action rather than a settings one: it is the
 * same authority as creating the staff accounts whose PINs it enables.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  linkDeviceSchema,
  deviceIdParamSchema,
  emptyQuerySchema,
} from '../validators/devices.js';
import { linkDevice, listDevices, unlinkDevice } from '../controllers/deviceController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.USER_MANAGE));

/** Link THIS browser to the administrator's restaurant. */
router.post(
  '/',
  validate({ body: linkDeviceSchema }),
  linkDevice,
);

/** Every terminal linked to this restaurant. */
router.get(
  '/',
  validate({ query: emptyQuerySchema }),
  listDevices,
);

/** Unlink a terminal — a machine lost, sold or replaced. */
router.delete(
  '/:id',
  validate({ params: deviceIdParamSchema }),
  unlinkDevice,
);

export default router;
