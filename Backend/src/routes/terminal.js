/**
 * The public terminal-label route.
 *
 * ── Why this is its own file ───────────────────────────────────────────────
 * It could have sat in auth.js. That would have been worse, and not for style
 * reasons: route-coverage.test.mjs decides whether a route is authenticated by
 * testing the WHOLE FILE for `router.use(requireAuth())`. auth.js contains a
 * `requireAuth()` on GET /me, so a public route added there would be credited
 * with auth it does not have and the guardrail would pass while the hole was
 * real. routes/invoice.js exists for exactly the same reason.
 *
 * A file with no `requireAuth()` anywhere trips that check honestly, forcing a
 * deliberate entry in the test's EXEMPTIONS list where a reviewer can see it.
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import { emptyQuerySchema } from '../validators/devices.js';
import { terminalInfo } from '../controllers/authController.js';

const router = Router();

/**
 * Which restaurant this browser's terminal belongs to.
 *
 * Read before anyone signs in, so the keypad can name the restaurant and the
 * terminal rather than presenting an anonymous PIN box. Returns
 * `{ linked: false }` for an unlinked or revoked machine — a normal state with
 * its own screen, not an error.
 */
router.get('/', apiLimiter, validate({ query: emptyQuerySchema }), terminalInfo);

export default router;
