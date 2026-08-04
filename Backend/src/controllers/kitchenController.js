/**
 * Kitchen board.
 *
 * ── One rule, enforced by the shape of the API ─────────────────────────────
 * A ticket moves exactly one step, forward, and the destination is computed
 * from what is STORED — never from what the client says. The advance endpoint
 * accepts no body at all, so there is no field in which to name a target.
 *
 * The alternative (`PATCH {status: 'served'}`) lets a mis-typed or malicious
 * request mark food served that was never cooked. The board clears, the order
 * leaves the line, and nobody notices until a customer asks where their meal
 * is.
 *
 * Backwards movement exists as a separate, admin-only `recall` — a kitchen is
 * a place where people tap the wrong card with wet hands, and a board that
 * cannot be corrected is one staff stop trusting. History stays append-only
 * either way.
 */
import mongoose from 'mongoose';
import { Ticket } from '../models/Ticket.js';

import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION, TICKET_STATUS, TICKET_STATUS_VALUES, NEXT_TICKET_STATUS } from '../constants/enums.js';
import { emitEvent, EVENTS, subscribeAll } from '../utils/eventBus.js';
import { signStreamToken, verifyStreamToken, STREAM_TOKEN_TTL_SECONDS } from '../utils/jwt.js';
import { User } from '../models/User.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

/**
 * The ticket shape the board renders.
 * `waitingMinutes` and `nextStatus` are derived so they cannot drift from the
 * stored status.
 */
function publicTicket(ticket) {
  const order = ticket.order;
  const populated = order && typeof order === 'object' && 'items' in order;

  return {
    id: String(ticket._id),
    no: ticket.no,
    source: ticket.source,
    type: ticket.type,
    status: ticket.status,
    nextStatus: NEXT_TICKET_STATUS[ticket.status] ?? null,
    placedAt: ticket.placedAt,
    readyAt: ticket.readyAt,
    waitingMinutes: Math.floor(
      ((ticket.readyAt?.getTime() ?? Date.now()) - new Date(ticket.placedAt).getTime()) / 60000,
    ),
    order: populated ? String(order._id) : String(order),
    items: populated
      ? order.items.map((line) => ({
          name: line.nameSnapshot,
          qty: line.qty,
          note: line.note,
        }))
      : undefined,
    // Reveals a correction without exposing the whole history on every poll.
    wasRecalled: ticket.statusHistory?.some((h) => h.recalled) ?? false,
  };
}

/** Only the fields the line needs. Prices are none of the kitchen's business. */
const ORDER_FIELDS = 'items._id items.nameSnapshot items.qty items.note';

// ---------------------------------------------------------------------------
// GET /api/kitchen/board
// ---------------------------------------------------------------------------
/**
 * The board, pre-grouped by column.
 *
 * Grouping server-side rather than shipping a flat list and letting the client
 * bucket it means one query, one shape, and no chance of the four columns
 * disagreeing about which ticket they hold.
 *
 * The served column is time-boxed: it exists so staff can confirm what just
 * went out, not as a history view.
 */
export const getBoard = asyncHandler(async (req, res) => {
  const { type, servedWithinMinutes } = req.query;

  const servedSince = new Date(Date.now() - servedWithinMinutes * 60000);

  const filter = {
    ...(type ? { type } : {}),
    $or: [
      { status: mongoose.trusted({ $ne: TICKET_STATUS.SERVED }) },
      { status: TICKET_STATUS.SERVED, updatedAt: mongoose.trusted({ $gte: servedSince }) },
    ],
  };

  const tickets = await Ticket.find(filter)
    .populate('order', ORDER_FIELDS)
    .sort({ placedAt: 1 })
    .limit(300);

  // Every column is present even when empty — the UI should not have to guard
  // against a missing key, and an absent column reads as a bug.
  const columns = Object.fromEntries(TICKET_STATUS_VALUES.map((s) => [s, []]));
  for (const ticket of tickets) columns[ticket.status].push(publicTicket(ticket));

  return sendSuccess(res, {
    columns,
    counts: Object.fromEntries(TICKET_STATUS_VALUES.map((s) => [s, columns[s].length])),
    servedWithinMinutes,
  });
});

// ---------------------------------------------------------------------------
// GET /api/kitchen/tickets
// ---------------------------------------------------------------------------
export const listTickets = asyncHandler(async (req, res) => {
  const { status, type, includeServed, limit } = req.query;

  const filter = {};
  if (status) filter.status = status;
  else if (includeServed !== 'true') {
    filter.status = mongoose.trusted({ $ne: TICKET_STATUS.SERVED });
  }
  if (type) filter.type = type;

  const tickets = await Ticket.find(filter)
    .populate('order', ORDER_FIELDS)
    .sort({ placedAt: 1 })
    .limit(limit);

  return sendSuccess(res, { tickets: tickets.map(publicTicket), count: tickets.length });
});

// ---------------------------------------------------------------------------
// GET /api/kitchen/tickets/:id
// ---------------------------------------------------------------------------
export const getTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id).populate('order', ORDER_FIELDS);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  return sendSuccess(res, { ticket: publicTicket(ticket) });
});

// ---------------------------------------------------------------------------
// PATCH /api/kitchen/tickets/:id/advance
// ---------------------------------------------------------------------------
/**
 * Move a ticket one step forward.
 *
 * The `status` precondition in the filter is what makes a double-tap safe:
 * two taps in quick succession both read `pending`, but only the first update
 * matches, and the second gets a 409 rather than skipping the ticket two
 * stages ahead.
 */
export const advanceTicket = asyncHandler(async (req, res) => {
  const current = await Ticket.findById(req.params.id);
  if (!current) throw ApiError.notFound('Ticket not found');

  const next = NEXT_TICKET_STATUS[current.status];
  if (!next) {
    throw ApiError.conflict(`That ticket is already ${current.status}`);
  }

  const now = new Date();
  const updated = await Ticket.findOneAndUpdate(
    // Guard on the status we just read — if someone else advanced it in the
    // meantime, this matches nothing.
    { _id: current._id, status: current.status },
    {
      $set: {
        status: next,
        ...(next === TICKET_STATUS.READY && !current.readyAt ? { readyAt: now } : {}),
      },
      $push: { statusHistory: { status: next, at: now, by: req.user.id, recalled: false } },
    },
    { new: true },
  ).populate('order', ORDER_FIELDS);

  if (!updated) {
    throw ApiError.conflict('That ticket was just moved by someone else');
  }

  const payload = publicTicket(updated);
  emitEvent(EVENTS.TICKET_ADVANCED, { ticket: payload });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TICKET_ADVANCE,
      resource: 'Ticket',
      resourceId: updated._id,
      meta: { no: updated.no, from: current.status, to: next },
    },
    req,
  );

  return sendSuccess(res, { ticket: payload });
});

// ---------------------------------------------------------------------------
// PATCH /api/kitchen/tickets/:id/recall     (admin only)
// ---------------------------------------------------------------------------
export const recallTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const index = TICKET_STATUS_VALUES.indexOf(ticket.status);
  if (index <= 0) {
    throw ApiError.conflict('That ticket is already at the first stage');
  }
  const previous = TICKET_STATUS_VALUES[index - 1];

  const now = new Date();
  const updated = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: ticket.status },
    {
      $set: {
        status: previous,
        // Stale readyAt would report a prep time that never happened.
        ...(previous === TICKET_STATUS.PENDING || previous === TICKET_STATUS.PREPARING
          ? { readyAt: null }
          : {}),
      },
      $push: { statusHistory: { status: previous, at: now, by: req.user.id, recalled: true } },
    },
    { new: true },
  ).populate('order', ORDER_FIELDS);

  if (!updated) throw ApiError.conflict('That ticket was just moved by someone else');

  const payload = publicTicket(updated);
  emitEvent(EVENTS.TICKET_RECALLED, { ticket: payload });

  await AuditLog.record(
    {
      action: AUDIT_ACTION.TICKET_ADVANCE,
      resource: 'Ticket',
      resourceId: updated._id,
      meta: { no: updated.no, from: ticket.status, to: previous, recalled: true },
    },
    req,
  );

  return sendSuccess(res, { ticket: payload });
});

// ---------------------------------------------------------------------------
// POST /api/kitchen/stream-token
// ---------------------------------------------------------------------------
/**
 * Mint a 60-second ticket for opening the SSE stream.
 * See the note on `signStreamToken` for why the access token is not used.
 */
export const createStreamToken = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    token: signStreamToken({
      id: req.user.id,
      role: req.user.role,
      tokenVersion: req.user.tokenVersion,
    }),
    expiresInSeconds: STREAM_TOKEN_TTL_SECONDS,
  }),
);

// ---------------------------------------------------------------------------
// GET /api/kitchen/stream?token=...
// ---------------------------------------------------------------------------
/**
 * Server-Sent Events stream of board changes.
 *
 * Authenticated by the short-lived stream token rather than the normal bearer
 * header, because `EventSource` cannot set headers. The token is verified
 * here, the user re-loaded from the database, and `kitchen:view` re-checked —
 * the same "authorise from stored state, never from the token" rule the rest
 * of the API follows.
 *
 * The client should still treat this as an optimisation: if the connection
 * drops, the board reloads from `GET /board`. Nothing here is the only path to
 * a piece of information.
 */
export const streamBoard = asyncHandler(async (req, res) => {
  const token = req.query.token;
  if (!token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = verifyStreamToken(String(token));
  } catch {
    throw ApiError.unauthorized();
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.isActive || (payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    throw ApiError.unauthorized();
  }
  if (!hasPermission(user.role, PERMISSIONS.KITCHEN_VIEW)) {
    throw ApiError.forbidden('Insufficient permissions');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, a reverse proxy will happily buffer the stream and the
    // board appears frozen while events pile up upstream.
    'X-Accel-Buffering': 'no',
  });

  const send = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      logger.warn('Failed writing to SSE stream', { requestId: req.id, message: err.message });
    }
  };

  send({ event: 'connected', at: new Date().toISOString() });

  const unsubscribe = subscribeAll(send);

  // Comment-only heartbeat. Idle connections are otherwise reaped by proxies
  // and load balancers after ~60s, and the board would silently stop updating
  // without ever reporting an error.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* the close handler below will clean up */
    }
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

/**
 * Announce a newly placed order to connected boards.
 * Called from the order controller so a ticket appears without waiting for the
 * next poll.
 */
export function announceNewTicket(ticket, order) {
  emitEvent(EVENTS.TICKET_CREATED, {
    ticket: {
      id: String(ticket._id),
      no: ticket.no,
      source: ticket.source,
      type: ticket.type,
      status: ticket.status,
      nextStatus: NEXT_TICKET_STATUS[ticket.status] ?? null,
      placedAt: ticket.placedAt,
      readyAt: null,
      waitingMinutes: 0,
      order: String(order._id),
      items: order.items.map((line) => ({
        name: line.nameSnapshot,
        qty: line.qty,
        note: line.note,
      })),
      wasRecalled: false,
    },
  });
}

export default {
  getBoard,
  listTickets,
  getTicket,
  advanceTicket,
  recallTicket,
  createStreamToken,
  streamBoard,
  announceNewTicket,
};
