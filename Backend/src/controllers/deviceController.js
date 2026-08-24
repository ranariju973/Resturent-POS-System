/**
 * Terminal management. Admin only — `user:manage`.
 *
 * Linking a terminal is what makes staff PIN sign-in possible at all: the
 * device cookie is how the server knows which restaurant a set of four digits
 * belongs to. See models/Device.js for why the binding lives on the machine.
 */
import { Device, mintDeviceToken, hashDeviceToken } from '../models/Device.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { deviceCookieOptions, clearDeviceCookieOptions, DEVICE_COOKIE } from '../utils/jwt.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

const publicDevice = (device) => ({
  id: String(device._id),
  name: device.name,
  lastSeenAt: device.lastSeenAt,
  isActive: device.isActive,
  createdAt: device.createdAt,
});

// ---------------------------------------------------------------------------
// POST /api/devices
// ---------------------------------------------------------------------------
/**
 * Link THIS browser to the signed-in administrator's restaurant.
 *
 * ── The token is never in the response body ────────────────────────────────
 * It goes out as an httpOnly cookie and nowhere else, exactly as the refresh
 * token does. A value in a body can be read by script, logged by a proxy, or
 * pasted into a support ticket; a value in an httpOnly cookie cannot. The
 * response says only which terminal was linked.
 *
 * A consequence worth stating: the token cannot be recovered or displayed
 * later. Re-linking a terminal means an owner signing in on it again, which is
 * the correct amount of friction for an action that grants a machine the
 * ability to resolve a restaurant.
 */
export const linkDevice = asyncHandler(async (req, res) => {
  const { name } = req.body;

  const token = mintDeviceToken();
  const device = await Device.create({
    name,
    tokenHash: hashDeviceToken(token),
    createdBy: req.user.id,
    lastSeenAt: null,
  });

  res.cookie(DEVICE_COOKIE, token, deviceCookieOptions());

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DEVICE_LINK,
      resource: 'Device',
      resourceId: device._id,
      meta: { name: device.name },
    },
    req,
  );

  logger.info('Terminal linked', {
    requestId: req.id,
    deviceId: String(device._id),
    tenantId: String(req.tenantId),
  });

  return sendSuccess(res, { terminal: publicDevice(device) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// GET /api/devices
// ---------------------------------------------------------------------------
/** Every terminal linked to this restaurant, most recently seen first. */
export const listDevices = asyncHandler(async (req, res) => {
  const devices = await Device.find({ isActive: true }).sort({ lastSeenAt: -1, createdAt: -1 });
  return sendSuccess(res, { terminals: devices.map(publicDevice) });
});

// ---------------------------------------------------------------------------
// DELETE /api/devices/:id
// ---------------------------------------------------------------------------
/**
 * Unlink a terminal — for a machine that was lost, sold or replaced.
 *
 * Deactivated rather than deleted: the audit trail refers to it, and a
 * decommissioned terminal is a fact worth keeping. Its token stops resolving
 * immediately, because findByToken requires isActive.
 */
export const unlinkDevice = asyncHandler(async (req, res) => {
  // +tokenHash so the "is this my own terminal?" check below can run — the
  // field is select:false, so without it verifyToken has nothing to compare.
  const device = await Device.findById(req.params.id).select('+tokenHash');
  if (!device || !device.isActive) throw ApiError.notFound('Terminal not found');

  device.isActive = false;
  await device.save();

  /*
   * Clear the cookie only if the request came FROM the terminal being
   * unlinked. An admin unlinking a lost tablet from the office must not have
   * their own machine silently un-linked as a side effect.
   */
  const ownToken = req.cookies?.[DEVICE_COOKIE];
  if (ownToken && device.verifyToken(ownToken)) {
    res.clearCookie(DEVICE_COOKIE, clearDeviceCookieOptions());
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DEVICE_UNLINK,
      resource: 'Device',
      resourceId: device._id,
      meta: { name: device.name },
    },
    req,
  );

  return sendSuccess(res, { unlinked: true, id: String(device._id) });
});

export default { linkDevice, listDevices, unlinkDevice };
