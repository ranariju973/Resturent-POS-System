/**
 * Customer routes.
 *
 * Admin and cashier hold all four customer permissions; kitchen staff hold
 * none, so every route here 403s for them.
 *
 * The one asymmetry is erasure: `DELETE /:id?erase=true` additionally requires
 * `user:manage` (admin). Ordinary deletion is reversible tidying; erasure is
 * an irreversible scrub of someone's personal data, and a cashier cleaning up
 * a mistyped entry should not be able to trigger it by adding a query param.
 * That check lives in the handler, where the query string is known.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { lookupLimiter } from '../middleware/rateLimit.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  lookupSchema,
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
  historySchema,
  deleteCustomerSchema,
  idParamSchema,
} from '../validators/customers.js';
import {
  lookupByPhone,
  listCustomers,
  getCustomer,
  getCustomerHistory,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../controllers/customerController.js';

const router = Router();

router.use(requireAuth());

/**
 * Phone lookup for the billing screen's auto-fill.
 *
 * Declared first, before `/:id`, or the parameterised route matches 'lookup'
 * as an id and the handler never runs. The same mistake has been caught by
 * tests in tables.js and menu.js; there is an assertion for it here too.
 *
 * Rate-limited per user rather than per IP: the endpoint resolves a phone
 * number to a person's name, and every till in a restaurant shares one public
 * address, so an IP budget would either throttle the second terminal or stop
 * nothing at all.
 */
router.get(
  '/lookup',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  lookupLimiter,
  validate({ query: lookupSchema }),
  lookupByPhone,
);

router.get(
  '/',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({ query: listCustomersSchema }),
  listCustomers,
);

router.post(
  '/',
  requirePermission(PERMISSIONS.CUSTOMER_CREATE),
  validate({ body: createCustomerSchema }),
  createCustomer,
);

// Declared before '/:id' so 'history' is never read as an id.
router.get(
  '/:id/history',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({ params: idParamSchema, query: historySchema }),
  getCustomerHistory,
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({ params: idParamSchema }),
  getCustomer,
);

router.put(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMER_EDIT),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  updateCustomer,
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMER_DELETE),
  validate({ params: idParamSchema, query: deleteCustomerSchema }),
  deleteCustomer,
);

export default router;
