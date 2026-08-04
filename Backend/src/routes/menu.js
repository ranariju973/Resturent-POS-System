/**
 * Menu routes.
 *
 * Every route carries requireAuth() and exactly one permission — including the
 * reads. `menu:view` is held by all three roles; everything else except the
 * stock toggle is admin-only.
 *
 * The ordering of the item routes matters: `/items/:id/availability` is
 * declared before `/items/:id` so the more specific path is not swallowed by
 * the parameterised one.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { uploadImage, verifyImageContent } from '../middleware/upload.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createItemSchema,
  updateItemSchema,
  availabilitySchema,
  listItemsSchema,
  createCategorySchema,
  updateCategorySchema,
  idParamSchema,
} from '../validators/menu.js';
import {
  listItems,
  getItem,
  createItem,
  updateItem,
  setAvailability,
  deleteItem,
} from '../controllers/menuController.js';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';

const router = Router();

// Everything below requires a session. Mounted once rather than repeated, but
// each route still names its own permission — see the RBAC notes in the README.
router.use(requireAuth());

// --- Categories ------------------------------------------------------------
router.get('/categories', requirePermission(PERMISSIONS.MENU_VIEW), listCategories);

router.post(
  '/categories',
  requirePermission(PERMISSIONS.MENU_CREATE),
  validate({ body: createCategorySchema }),
  createCategory,
);

router.put(
  '/categories/:id',
  requirePermission(PERMISSIONS.MENU_EDIT),
  validate({ params: idParamSchema, body: updateCategorySchema }),
  updateCategory,
);

router.delete(
  '/categories/:id',
  requirePermission(PERMISSIONS.MENU_DELETE),
  validate({ params: idParamSchema }),
  deleteCategory,
);

// --- Items -----------------------------------------------------------------
router.get(
  '/items',
  requirePermission(PERMISSIONS.MENU_VIEW),
  validate({ query: listItemsSchema }),
  listItems,
);

/**
 * The stock in / sold out toggle — admin, cashier and kitchen staff.
 *
 * Declared before `/items/:id` so Express matches it first. Its schema accepts
 * a single boolean and rejects anything else, which is what keeps this
 * endpoint's blast radius fixed even though three roles can reach it.
 */
router.patch(
  '/items/:id/availability',
  requirePermission(PERMISSIONS.MENU_TOGGLE_STOCK),
  validate({ params: idParamSchema, body: availabilitySchema }),
  setAvailability,
);

router.get(
  '/items/:id',
  requirePermission(PERMISSIONS.MENU_VIEW),
  validate({ params: idParamSchema }),
  getItem,
);

/**
 * Create and update accept multipart/form-data with an optional `image`.
 *
 * Middleware order is load-bearing: multer must parse the body before the
 * validator can see the text fields, and the content check must run on the
 * parsed buffer before the controller uploads anything to Cloudinary.
 */
router.post(
  '/items',
  requirePermission(PERMISSIONS.MENU_CREATE),
  uploadImage('image'),
  verifyImageContent,
  validate({ body: createItemSchema }),
  createItem,
);

router.put(
  '/items/:id',
  requirePermission(PERMISSIONS.MENU_EDIT),
  uploadImage('image'),
  verifyImageContent,
  validate({ params: idParamSchema, body: updateItemSchema }),
  updateItem,
);

router.delete(
  '/items/:id',
  requirePermission(PERMISSIONS.MENU_DELETE),
  validate({ params: idParamSchema }),
  deleteItem,
);

export default router;
