/**
 * Menu category handlers.
 *
 * Categories are referenced by menu items, so deletion is soft and guarded:
 * removing a category that still has live items would leave those items
 * pointing at nothing, and the POS grid would render them under a blank pill.
 */
import { Category } from '../models/Category.js';
import { MenuItem } from '../models/MenuItem.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';

const publicCategory = (category, itemCount) => ({
  id: String(category._id),
  name: category.name,
  color: category.color,
  sortOrder: category.sortOrder,
  ...(itemCount === undefined ? {} : { itemCount }),
});

// ---------------------------------------------------------------------------
// GET /api/menu/categories
// ---------------------------------------------------------------------------
export const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });

  // One aggregation for all counts rather than a query per category — the
  // N+1 that turns a 5-category menu into 6 round trips.
  const counts = await MenuItem.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.count]));

  return sendSuccess(res, {
    categories: categories.map((c) => publicCategory(c, countBy.get(String(c._id)) ?? 0)),
  });
});

// ---------------------------------------------------------------------------
// POST /api/menu/categories        (admin)
// ---------------------------------------------------------------------------
export const createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_CREATE,
      resource: 'Category',
      resourceId: category._id,
      meta: { name: category.name },
    },
    req,
  );

  return sendSuccess(res, { category: publicCategory(category, 0) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// PUT /api/menu/categories/:id     (admin)
// ---------------------------------------------------------------------------
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ _id: req.params.id, isActive: true });
  if (!category) throw ApiError.notFound('Category not found');

  Object.assign(category, req.body);
  await category.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_UPDATE,
      resource: 'Category',
      resourceId: category._id,
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { category: publicCategory(category) });
});

// ---------------------------------------------------------------------------
// DELETE /api/menu/categories/:id  (admin)
// ---------------------------------------------------------------------------
/**
 * Refuses while live items still reference the category.
 *
 * The alternative — cascading the delete to its items — would remove products
 * from the POS mid-service on a single click, which is not a decision this
 * endpoint should make on the admin's behalf. A 409 naming the count lets them
 * move or delete the items first.
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ _id: req.params.id, isActive: true });
  if (!category) throw ApiError.notFound('Category not found');

  const itemCount = await MenuItem.countDocuments({ category: category._id, isActive: true });
  if (itemCount > 0) {
    throw ApiError.conflict(
      `Cannot delete a category that still has ${itemCount} item${itemCount === 1 ? '' : 's'}`,
    );
  }

  category.isActive = false;
  await category.save();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.MENU_ITEM_DELETE,
      resource: 'Category',
      resourceId: category._id,
      meta: { name: category.name },
    },
    req,
  );

  return sendSuccess(res, { deleted: true, id: String(category._id) });
});

export default { listCategories, createCategory, updateCategory, deleteCategory };
