/**
 * Terminal routes. Admin only.
 *
 * Linking a terminal is what lets staff sign in with a PIN at all — the device
 * cookie is how the server resolves which restaurant four digits belong to.
 * That makes it a `user:manage` action rather than a settings one: it is the
 * same authority as creating the staff accounts whose PINs it enables.
 *
 * ── Why these are mounted under /api/auth ──────────────────────────────────
 * The device cookie is scoped to `path: '/api/auth'` (see utils/jwt.js), and a
 * browser only sends a cookie to its own path. Mounted at /api/devices, these
 * handlers could SET that cookie but never READ it — which silently disabled
 * the "am I unlinking the machine I am sitting at?" check in unlinkDevice.
 * Keeping every handler that reasons about "which terminal is this browser"
 * inside the cookie's path is what makes that check able to run at all.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  linkDeviceSchema,
  renameDeviceSchema,
  relinkDeviceSchema,
  deviceIdParamSchema,
  emptyQuerySchema,
} from '../validators/devices.js';
import {
  linkDevice,
  relinkDevice,
  renameDevice,
  listDevices,
  unlinkDevice,
} from '../controllers/deviceController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.USER_MANAGE));

/** Link THIS browser to the administrator's restaurant as a NEW terminal. */
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

/**
 * Point an EXISTING terminal at this browser.
 *
 * The verb that was missing: without it, a machine that lost its cookie could
 * only be set up as a brand-new terminal, and the name it already had was
 * permanently taken by its own old row.
 */
router.post(
  '/:id/relink',
  validate({ params: deviceIdParamSchema, body: relinkDeviceSchema }),
  relinkDevice,
);

/** Rename a terminal. Touches the label only — never the binding. */
router.patch(
  '/:id',
  validate({ params: deviceIdParamSchema, body: renameDeviceSchema }),
  renameDevice,
);

/** Unlink a terminal — a machine lost, sold or replaced. */
router.delete(
  '/:id',
  validate({ params: deviceIdParamSchema }),
  unlinkDevice,
);

export default router;
