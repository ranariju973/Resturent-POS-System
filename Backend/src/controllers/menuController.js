/**
 * Menu item handlers.
 *
 * ── Cloudinary bookkeeping ─────────────────────────────────────────────────
 * Every upload creates a remote asset that this application is responsible for
 * deleting. Three places have to clean up, and missing any one of them leaks
 * storage that nothing will ever reclaim:
 *
 *   • replacing an image  — the previous asset is orphaned
 *   • deleting an item    — its asset is orphaned
 *   • a failed save AFTER a successful upload — the asset exists but no
 *     document references it, so nothing can ever find it again
 *
 * The third is the one that gets forgotten. It is handled explicitly below.
 */
import { MenuItem } from '../models/MenuItem.js';
import { Category } from '../models/Category.js';
import { Order } from '../models/Order.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { can } from '../middleware/rbac.js';
import { uploadImageBuffer, deleteImage } from '../config/cloudinary.js';
import { escapeRegex } from '../models/Customer.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { toMajor } from '../utils/money.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

/**
 * The item shape sent to clients.
 *
 * Exposes `price` in major units alongside `priceMinor`, because the frontend
 * renders currency and should not be doing unit conversion in a template. The
 * minor value stays authoritative; `price` is derived and never accepted back.
 */
function publicItem(item) {
  const category = item.category;
  const populated = category && typeof category === 'object' && 'name' in category;

  return {
    id: String(item._id),
    name: item.name,
    priceMinor: item.priceMinor,
    price: toMajor(item.priceMinor),
    category: populated ? String(category._id) : String(category),
    categoryName: populated ? category.name : undefined,
    categoryColor: populated ? category.color : undefined,
    description: item.description ?? '',
    imageUrl: item.imageUrl ?? '',
    available: item.available,
    isActive: item.isActive,
    updatedAt: item.updatedAt,
  };
}

/** Remove an orphaned upload, logging rather than throwing — see below. */
async function discardUpload(publicId, req, reason) {
  if (!publicId) return;
  try {
    await deleteImage(publicId);
  } catch (err) {
    // The request has already failed or succeeded on its own terms; failing it
    // again over cleanup would be worse than the leak. Log loudly instead so
    // the orphan is at least findable.
    logger.error('Failed to remove Cloudinary asset — possible orphan', {
      requestId: req.id,
      publicId,
      reason,
      message: err.message,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/menu/items
// ---------------------------------------------------------------------------
export const listItems = asyncHandler(async (req, res) => {
  const { category, available, search, limit, includeInactive } = req.query;

  const filter = {};

  // Soft-deleted items are admin-only, and only on request. The permission is
  // checked here rather than trusting the query flag.
  const maySeeInactive = can(req, PERMISSIONS.MENU_DELETE);
  if (!(includeInactive === 'true' && maySeeInactive)) filter.isActive = true;

  if (category) filter.category = category;
  if (available !== undefined) filter.available = available === 'true';

  if (search) {
    // Escaped before interpolation — an unescaped search term is a ReDoS.
    // trusted() because `sanitizeFilter` is on globally (src/config/db.js).
    filter.name = mongoose.trusted({ $regex: escapeRegex(search), $options: 'i' });
  }

  const items = await MenuItem.find(filter)
    .populate('category', 'name color sortOrder')
    .sort({ name: 1 })
    .limit(limit);

  return sendSuccess(res, { items: items.map(publicItem), count: items.length });
});

// ---------------------------------------------------------------------------
// GET /api/menu/items/:id
// ---------------------------------------------------------------------------
export const getItem = asyncHandler(async (req, res) => {
  const item = await MenuItem.findById(req.params.id).populate('category', 'name color');
  if (!item || !item.isActive) throw ApiError.notFound('Menu item not found');
  return sendSuccess(res, { item: publicItem(item) });
});

// ---------------------------------------------------------------------------
// POST /api/menu/items          (admin)
// ---------------------------------------------------------------------------
export const createItem = asyncHandler(async (req, res) => {
  // The validator converted the request's major-unit `price` into `priceMinor`.
  const { name, priceMinor, category, description, available } = req.body;

  const categoryDoc = await Category.findOne({ _id: category, isActive: true });
  if (!categoryDoc) throw ApiError.badRequest('Category not found');

  let uploaded = null;
  if (req.file) {
    uploaded = await uploadImageBuffer(req.file.buffer);
  }

  const item = new MenuItem({
    name,
    priceMinor,
    category: categoryDoc._id,
    description,
    available,
    imageUrl: uploaded?.url ?? '',
    imagePublicId: uploaded?.publicId ?? null,
  });

  try {
    await item.save();
  } catch (err) {
    // The upload succeeded but the document did not save — most often a
    // duplicate name in the category. Without this, the asset is stranded in
    // Cloudinary with nothing pointing at it.
    await discardUpload(uploaded?.publicId, req, 'item-save-failed');
    throw err;
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_CREATE,
      resource: 'MenuItem',
      resourceId: item._id,
      meta: { name: item.name, priceMinor: item.priceMinor, hasImage: Boolean(uploaded) },
    },
    req,
  );

  await item.populate('category', 'name color');
  return sendSuccess(res, { item: publicItem(item) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// PUT /api/menu/items/:id       (admin)
// ---------------------------------------------------------------------------
export const updateItem = asyncHandler(async (req, res) => {
  const item = await MenuItem.findById(req.params.id).select('+imagePublicId');
  if (!item || !item.isActive) throw ApiError.notFound('Menu item not found');

  const { name, priceMinor, category, description, available, removeImage } = req.body;

  if (category) {
    const categoryDoc = await Category.findOne({ _id: category, isActive: true });
    if (!categoryDoc) throw ApiError.badRequest('Category not found');
    item.category = categoryDoc._id;
  }

  const previousPrice = item.priceMinor;
  const previousPublicId = item.imagePublicId;

  if (name !== undefined) item.name = name;
  if (priceMinor !== undefined) item.priceMinor = priceMinor;
  if (description !== undefined) item.description = description;
  if (available !== undefined) item.available = available;

  let uploaded = null;
  if (req.file) {
    uploaded = await uploadImageBuffer(req.file.buffer);
    item.imageUrl = uploaded.url;
    item.imagePublicId = uploaded.publicId;
  } else if (removeImage) {
    item.imageUrl = '';
    item.imagePublicId = null;
  }

  try {
    await item.save();
  } catch (err) {
    await discardUpload(uploaded?.publicId, req, 'item-update-failed');
    throw err;
  }

  // Only once the document is safely saved is the old asset removed. Doing it
  // earlier would destroy the existing image on a save that then failed.
  if ((uploaded || removeImage) && previousPublicId && previousPublicId !== item.imagePublicId) {
    await discardUpload(previousPublicId, req, 'image-replaced');
  }

  // A price change is the audit entry that matters most on this model — it is
  // the difference between a menu correction and a quiet markdown.
  if (priceMinor !== undefined && previousPrice !== item.priceMinor) {
    await AuditLog.record(
      {
        action: AUDIT_ACTION.MENU_ITEM_PRICE_CHANGE,
        resource: 'MenuItem',
        resourceId: item._id,
        meta: { name: item.name, from: previousPrice, to: item.priceMinor },
      },
      req,
    );
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_UPDATE,
      resource: 'MenuItem',
      resourceId: item._id,
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  await item.populate('category', 'name color');
  return sendSuccess(res, { item: publicItem(item) });
});

// ---------------------------------------------------------------------------
// PATCH /api/menu/items/:id/availability     (admin, cashier, kitchen staff)
// ---------------------------------------------------------------------------
/**
 * The stock in / sold out toggle.
 *
 * Reachable by every role, so it is written to touch exactly one field. It
 * loads the document and assigns `available` rather than passing the body to
 * an update — if the schema and this handler ever disagree about what the body
 * may contain, the handler still cannot write anything else.
 */
export const setAvailability = asyncHandler(async (req, res) => {
  const item = await MenuItem.findById(req.params.id);
  if (!item || !item.isActive) throw ApiError.notFound('Menu item not found');

  const { available } = req.body;
  if (item.available === available) {
    await item.populate('category', 'name color');
    return sendSuccess(res, { item: publicItem(item) });
  }

  item.available = available;
  await item.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_STOCK_TOGGLE,
      resource: 'MenuItem',
      resourceId: item._id,
      meta: { name: item.name, available },
    },
    req,
  );

  await item.populate('category', 'name color');
  return sendSuccess(res, { item: publicItem(item) });
});

// ---------------------------------------------------------------------------
// DELETE /api/menu/items/:id     (admin)
// ---------------------------------------------------------------------------
/**
 * Soft delete.
 *
 * The document survives because historical orders reference it. The Cloudinary
 * asset does not: there is no restore endpoint, so keeping the image would
 * accumulate storage nothing can reach. Orders snapshot the item's name and
 * price, not its image, so no receipt is affected.
 */
export const deleteItem = asyncHandler(async (req, res) => {
  const item = await MenuItem.findById(req.params.id).select('+imagePublicId');
  if (!item || !item.isActive) throw ApiError.notFound('Menu item not found');

  const publicId = item.imagePublicId;

  await item.softDelete();

  if (publicId) {
    await discardUpload(publicId, req, 'item-deleted');
    await MenuItem.updateOne({ _id: item._id }, { $set: { imageUrl: '', imagePublicId: null } });
  }

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_DELETE,
      resource: 'MenuItem',
      resourceId: item._id,
      meta: { name: item.name },
    },
    req,
  );

  return sendSuccess(res, { deleted: true, id: String(item._id) });
});

// ---------------------------------------------------------------------------
// DELETE /api/menu/items/:id/purge
// ---------------------------------------------------------------------------
/**
 * Irreversibly remove a menu item.
 *
 * ── Why this can exist at all ──────────────────────────────────────────────
 * The ordinary delete is soft because orders reference menu items and history
 * has to keep resolving. That reasoning only holds for items that HAVE
 * history. An item added by mistake at 9am and removed at 9:01, never ordered,
 * is referenced by nothing — keeping its row forever is hoarding, not
 * integrity.
 *
 * So the safety property is not "admins are careful". It is that the server
 * refuses when a single order line points at this item. The check is the
 * feature; the deletion is the easy part.
 *
 * ── Why the check is a query and not a flag ────────────────────────────────
 * A cached "wasOrdered" boolean on the item would be one more thing that can
 * drift out of step with the orders collection, and the direction it drifts in
 * is the dangerous one: stale `false` means purging an item that a receipt
 * still needs. Asking the orders collection costs one indexed lookup and
 * cannot be wrong.
 */
export const purgeItem = asyncHandler(async (req, res) => {
  // Soft-deleted items are the usual subject here, so this deliberately does
  // not filter on isActive the way deleteItem does.
  const item = await MenuItem.findById(req.params.id).select('+imagePublicId');
  if (!item) throw ApiError.notFound('Menu item not found');

  const onAnOrder = await Order.exists({ 'items.menuItem': item._id });
  if (onAnOrder) {
    throw ApiError.conflict(
      'This item appears on past orders and cannot be permanently deleted. ' +
        'It has been kept so receipts and reports still resolve.',
    );
  }

  const publicId = item.imagePublicId;
  const snapshot = { name: item.name, priceMinor: item.priceMinor, category: item.category };

  // Order matters: drop the row first, then the asset. A failed Cloudinary
  // call after the row is gone leaks one image, which is recoverable. A
  // deleted asset followed by a failed row delete leaves a live menu item
  // with a broken picture, which is not.
  await MenuItem.deleteOne({ _id: item._id });
  if (publicId) await discardUpload(publicId, req, 'item-purged');

  // Written after the fact deliberately: once the row is gone this entry is
  // the only record that the item ever existed, so it carries a snapshot
  // rather than just an id that now resolves to nothing.
  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_PURGE,
      resource: 'MenuItem',
      resourceId: item._id,
      meta: snapshot,
    },
    req,
  );

  return sendSuccess(res, { purged: true, id: String(item._id) });
});

export default {
  listItems,
  getItem,
  createItem,
  updateItem,
  setAvailability,
  deleteItem,
  purgeItem,
};
