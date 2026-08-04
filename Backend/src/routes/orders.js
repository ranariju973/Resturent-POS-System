/**
 * Order routes.
 *
 * `pos:create_order` covers taking and editing a tab — a cashier's core job.
 * `pos:apply_discount` guards the discount endpoint, with a ceiling enforced
 * inside the handler (a permission is binary; the ceiling is a quantity).
 * `pos:void_order` is admin-only, and the handler provides the manager-
 * override path for a cashier acting with approval.
 *
 * Kitchen staff hold none of these, so every route here 403s for them.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createOrderSchema,
  updateItemsSchema,
  discountSchema,
  paySchema,
  voidSchema,
  deleteOrderSchema,
  listOrdersSchema,
  idParamSchema,
} from '../validators/orders.js';
import {
  createOrder,
  listOrders,
  getOrder,
  updateOrderItems,
  applyDiscount,
  payOrder,
  voidOrder,
  deleteOrder,
} from '../controllers/orderController.js';

const router = Router();

router.use(requireAuth());

router.get(
  '/',
  requirePermission(PERMISSIONS.POS_CREATE_ORDER),
  validate({ query: listOrdersSchema }),
  listOrders,
);

router.post(
  '/',
  requirePermission(PERMISSIONS.POS_CREATE_ORDER),
  validate({ body: createOrderSchema }),
  createOrder,
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.POS_CREATE_ORDER),
  validate({ params: idParamSchema }),
  getOrder,
);

router.patch(
  '/:id/items',
  requirePermission(PERMISSIONS.POS_CREATE_ORDER),
  validate({ params: idParamSchema, body: updateItemsSchema }),
  updateOrderItems,
);

router.patch(
  '/:id/discount',
  requirePermission(PERMISSIONS.POS_APPLY_DISCOUNT),
  validate({ params: idParamSchema, body: discountSchema }),
  applyDiscount,
);

router.post(
  '/:id/pay',
  requirePermission(PERMISSIONS.POS_CREATE_ORDER),
  validate({ params: idParamSchema, body: paySchema }),
  payOrder,
);

/**
 * Voiding is gated at `pos:create_order` rather than `pos:void_order` because
 * abandoning an UNPAID tab is ordinary cashier work. The handler enforces the
 * real rule: voiding a PAID bill needs `pos:void_order` or a manager override.
 * Gating the route itself on the stricter permission would make the common
 * case impossible for the people who do it.
 */
router.post(
  '/:id/void',
  requirePermission(PERMISSIONS.POS_CREATE_ORDER),
  validate({ params: idParamSchema, body: voidSchema }),
  voidOrder,
);

/**
 * Permanent deletion — admin only, via its own permission.
 *
 * Deliberately NOT gated on `pos:void_order`. Voiding and deleting are
 * different powers: the first is ordinary service recovery, the second
 * destroys the record of a sale. Sharing a permission between them would hand
 * the destructive one to everyone who legitimately needs the ordinary one.
 */
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.ORDER_DELETE),
  validate({ params: idParamSchema, body: deleteOrderSchema }),
  deleteOrder,
);

export default router;
