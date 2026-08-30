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

/**
 * The live terminal in THIS restaurant holding that name, if any.
 *
 * Case- and accent-insensitively, because that is how the unique index
 * compares — `{ tenantId, name }` carries `collation: { locale: 'en', strength:
 * 2 }`. A check that compared exactly would pass "terminal 1" and then be
 * refused by the database for colliding with "Terminal 1", which is precisely
 * the confusion this pre-check exists to avoid.
 *
 * The tenant filter is added by the model plugin, so this can only ever see
 * the caller's own restaurant.
 */
const findActiveByName = (name) =>
  Device.findOne({ name, isActive: true }).collation({ locale: 'en', strength: 2 });

/**
 * The answer to "that name is already in use".
 *
 * ── Why the code matters more than the message ────────────────────────────
 * A bare 409 leaves the client with nothing to offer but "pick another name",
 * which is how one till ends up answering to Terminal 1, 4 and 7. The stable
 * code lets the setup screen recognise this particular refusal and respond
 * usefully — "that is an existing terminal; is this machine it?" — selecting
 * the matching row from the list it already holds and offering to re-link.
 *
 * The id is deliberately NOT smuggled into the envelope. The client is showing
 * a picker built from GET /devices, so it can resolve the name to a row
 * without this response teaching the error handler a new field.
 */
const nameTakenError = (device) =>
  ApiError.conflict(`A terminal named “${device.name}” already exists`, {
    code: 'TERMINAL_NAME_TAKEN',
    details: [{ field: 'name', message: 'That terminal name is already in use' }],
  });

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

  /*
   * ── Why the collision is answered, not merely refused ────────────────────
   * Terminal names are unique per restaurant among live devices, and this
   * route can only ever CREATE. Together those meant a name was consumed the
   * first time it was used and could never be reclaimed: an owner whose
   * browser had lost its device cookie — which happens routinely on a shared
   * machine, since the cookie is one per browser and the last owner to link
   * overwrites it — was told "a record with that name already exists" and left
   * inventing Terminal 4, Terminal 5, Terminal 6 for the same physical till.
   *
   * The row they collided with is almost always their own machine's. So the
   * answer carries its id, and the client offers to re-link to it (see
   * relinkDevice) instead of presenting a dead end.
   */
  const clash = await findActiveByName(name);
  if (clash) throw nameTakenError(clash);

  const token = mintDeviceToken();

  let device;
  try {
    device = await Device.create({
      name,
      tokenHash: hashDeviceToken(token),
      createdBy: req.user.id,
      lastSeenAt: null,
    });
  } catch (err) {
    // The check above and this write are two round trips. The unique index is
    // what actually decides; same answer either way.
    if (err?.code === 11000) {
      const existing = await findActiveByName(name);
      throw existing ? nameTakenError(existing) : err;
    }
    throw err;
  }

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
// POST /api/auth/devices/:id/relink
// ---------------------------------------------------------------------------
/**
 * Point an EXISTING terminal at the browser making this request.
 *
 * ── The bug this closes ────────────────────────────────────────────────────
 * The device cookie belongs to the browser, not the account, and it
 * deliberately survives logout — a till must not need re-linking every time a
 * cashier's shift ends. On a shared browser that means the last owner to link
 * owns the cookie, and everyone else's session correctly reports "this machine
 * is not your terminal". Correct, but until now unrecoverable: the only way
 * forward was to link again, and linking could only create, and creating
 * collided with the name the machine already had.
 *
 * Re-linking is the missing verb. It says "this browser is Terminal 1 again"
 * without inventing a second Terminal 1.
 *
 * ── What it costs, stated so the UI can warn about it ──────────────────────
 * The token is ROTATED, not shared. One terminal is one machine, so whichever
 * browser held this terminal before stops resolving it and has to be set up
 * again. That is the honest behaviour — two machines quietly answering to one
 * terminal would make `lastSeenAt` and the audit trail lie about where a shift
 * was worked — and it is why this is audited under its own action.
 *
 * Cross-restaurant relinking is impossible by construction: the lookup is
 * tenant-scoped by the model plugin, so another restaurant's terminal is
 * simply not found.
 */
export const relinkDevice = asyncHandler(async (req, res) => {
  const device = await Device.findById(req.params.id);
  if (!device || !device.isActive) throw ApiError.notFound('Terminal not found');

  const token = mintDeviceToken();
  device.tokenHash = hashDeviceToken(token);
  /*
   * Reset rather than preserved: `lastSeenAt` answers "has a shift been worked
   * on this terminal", and the machine that did the working is exactly what
   * just changed. Carrying the old timestamp over would attribute one browser's
   * activity to another.
   */
  device.lastSeenAt = null;
  await device.save();

  res.cookie(DEVICE_COOKIE, token, deviceCookieOptions());

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DEVICE_RELINK,
      resource: 'Device',
      resourceId: device._id,
      meta: { name: device.name },
    },
    req,
  );

  logger.info('Terminal re-linked to a new browser', {
    requestId: req.id,
    deviceId: String(device._id),
    tenantId: String(req.tenantId),
  });

  return sendSuccess(res, { terminal: publicDevice(device) });
});

// ---------------------------------------------------------------------------
// PATCH /api/auth/devices/:id
// ---------------------------------------------------------------------------
/**
 * Rename a terminal.
 *
 * Touches the label and nothing else — the binding is the token, so a rename
 * cannot disturb which machine answers to it. Exists because the name is typed
 * once, under time pressure, by someone setting up a till, and a typo that can
 * never be corrected is a small permanent irritation on a screen staff read
 * every day.
 */
export const renameDevice = asyncHandler(async (req, res) => {
  const { name } = req.body;

  const device = await Device.findById(req.params.id);
  if (!device || !device.isActive) throw ApiError.notFound('Terminal not found');

  const previous = device.name;
  if (previous === name) return sendSuccess(res, { terminal: publicDevice(device) });

  const clash = await findActiveByName(name);
  if (clash && String(clash._id) !== String(device._id)) throw nameTakenError(clash);

  device.name = name;

  try {
    await device.save();
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await findActiveByName(name);
      throw existing ? nameTakenError(existing) : err;
    }
    throw err;
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DEVICE_RENAME,
      resource: 'Device',
      resourceId: device._id,
      meta: { from: previous, to: device.name },
    },
    req,
  );

  return sendSuccess(res, { terminal: publicDevice(device) });
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

export default { linkDevice, relinkDevice, renameDevice, listDevices, unlinkDevice };
