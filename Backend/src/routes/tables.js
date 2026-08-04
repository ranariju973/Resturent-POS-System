/**
 * Table routes.
 *
 * The split that matters here is CONFIGURING the floor plan versus OPERATING
 * it. Creating, renaming, resizing and deleting tables are admin-only
 * (`table:create` / `table:edit` / `table:delete`). Seating, reserving,
 * releasing, transferring, merging and splitting are the cashier's job
 * (`table:manage_seating`) — those are the things that happen fifty times a
 * shift, and a cashier who cannot do them cannot work the floor.
 *
 * Kitchen staff hold neither permission, so every route here 403s for them.
 *
 * `/zones` is declared before `/:id` so it is not captured as an id.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createTableSchema,
  updateTableSchema,
  listTablesSchema,
  seatSchema,
  reserveSchema,
  transferSchema,
  mergeSchema,
  splitSchema,
  idParamSchema,
} from '../validators/tables.js';
import {
  listTables,
  listZones,
  getTable,
  createTable,
  updateTable,
  deleteTable,
  seatTable,
  reserveTable,
  releaseTable,
  transferTable,
  mergeTable,
  unmergeTable,
  splitBill,
} from '../controllers/tableController.js';

const router = Router();

router.use(requireAuth());

// --- Reads -----------------------------------------------------------------
router.get(
  '/',
  requirePermission(PERMISSIONS.TABLE_VIEW),
  validate({ query: listTablesSchema }),
  listTables,
);

// Before '/:id', or 'zones' is read as an id and fails validation.
router.get('/zones', requirePermission(PERMISSIONS.TABLE_VIEW), listZones);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.TABLE_VIEW),
  validate({ params: idParamSchema }),
  getTable,
);

// --- Configuration (admin only) -------------------------------------------
router.post(
  '/',
  requirePermission(PERMISSIONS.TABLE_CREATE),
  validate({ body: createTableSchema }),
  createTable,
);

router.put(
  '/:id',
  requirePermission(PERMISSIONS.TABLE_EDIT),
  validate({ params: idParamSchema, body: updateTableSchema }),
  updateTable,
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.TABLE_DELETE),
  validate({ params: idParamSchema }),
  deleteTable,
);

// --- Operating the floor (admin + cashier) --------------------------------
router.patch(
  '/:id/seat',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema, body: seatSchema }),
  seatTable,
);

router.patch(
  '/:id/reserve',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema, body: reserveSchema }),
  reserveTable,
);

router.patch(
  '/:id/release',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema }),
  releaseTable,
);

router.post(
  '/:id/transfer',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema, body: transferSchema }),
  transferTable,
);

router.post(
  '/:id/merge',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema, body: mergeSchema }),
  mergeTable,
);

router.post(
  '/:id/unmerge',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema }),
  unmergeTable,
);

router.post(
  '/:id/split',
  requirePermission(PERMISSIONS.TABLE_MANAGE_SEATING),
  validate({ params: idParamSchema, body: splitSchema }),
  splitBill,
);

export default router;
