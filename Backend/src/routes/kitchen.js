/**
 * Kitchen routes.
 *
 * All three roles hold `kitchen:view` and `kitchen:advance_status` — the board
 * is the one screen a kitchen staffer, a cashier and an admin all work from,
 * and any of them may move a ticket along.
 *
 * `kitchen:recall` is admin-only. See the note on `Ticket.recall()`.
 *
 * The stream is authenticated differently from everything else: `EventSource`
 * cannot set headers, so it carries a 60-second single-purpose token in the
 * query string instead. `streamBoard` verifies that token, re-loads the user,
 * and re-checks the permission itself, so it does NOT sit behind requireAuth.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  listTicketsSchema,
  boardSchema,
  emptyBodySchema,
  idParamSchema,
} from '../validators/kitchen.js';
import {
  getBoard,
  listTickets,
  getTicket,
  advanceTicket,
  recallTicket,
  createStreamToken,
  streamBoard,
} from '../controllers/kitchenController.js';

const router = Router();

/**
 * Declared BEFORE `router.use(requireAuth())` because it authenticates itself
 * from the query-string token. Putting it after would reject every EventSource
 * connection for lacking an Authorization header.
 */
router.get('/stream', streamBoard);

router.use(requireAuth());

router.get(
  '/board',
  requirePermission(PERMISSIONS.KITCHEN_VIEW),
  validate({ query: boardSchema }),
  getBoard,
);

router.get(
  '/tickets',
  requirePermission(PERMISSIONS.KITCHEN_VIEW),
  validate({ query: listTicketsSchema }),
  listTickets,
);

router.get(
  '/tickets/:id',
  requirePermission(PERMISSIONS.KITCHEN_VIEW),
  validate({ params: idParamSchema }),
  getTicket,
);

/**
 * Advance takes an EMPTY body — the destination is derived from the stored
 * status. `emptyBodySchema` is `.strict()`, so a client sending
 * `{status: 'served'}` gets a 400 rather than having it silently ignored:
 * the attempt shows up in the logs instead of looking like it worked.
 */
router.patch(
  '/tickets/:id/advance',
  requirePermission(PERMISSIONS.KITCHEN_ADVANCE_STATUS),
  validate({ params: idParamSchema, body: emptyBodySchema }),
  advanceTicket,
);

router.patch(
  '/tickets/:id/recall',
  requirePermission(PERMISSIONS.KITCHEN_RECALL),
  validate({ params: idParamSchema, body: emptyBodySchema }),
  recallTicket,
);

/** Exchange a session for a 60-second ticket to open the stream. */
router.post('/stream-token', requirePermission(PERMISSIONS.KITCHEN_VIEW), createStreamToken);

export default router;
