/**
 * The public invoice route. The only data route in the app without a session.
 *
 * ── Why this is its own file ───────────────────────────────────────────────
 * It could have been declared above `router.use(requireAuth())` inside
 * orders.js. That would have been worse, and not for style reasons:
 * route-coverage.test.mjs decides whether a route is authenticated by testing
 * the WHOLE FILE for `router.use(requireAuth())`. A public route living in a
 * file that also contains that line is credited with auth it does not have,
 * and the guardrail passes while the hole is real.
 *
 * A file with no `requireAuth()` anywhere trips that check honestly, which
 * forces a deliberate entry in the test's EXEMPTIONS list — a reviewer then
 * sees the exemption and its stated reason. The test is only doing its job if
 * it is given honest input.
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { invoiceLimiter } from '../middleware/rateLimit.js';
import { invoiceSlugSchema } from '../validators/invoice.js';
import { getPublicInvoice } from '../controllers/invoiceController.js';

const router = Router();

router.get(
  '/:slug',
  invoiceLimiter,
  validate({ params: invoiceSlugSchema }),
  getPublicInvoice,
);

export default router;
