/**
 * In-process event bus for live updates.
 *
 * ── Why not Socket.IO ──────────────────────────────────────────────────────
 * The kitchen board only ever needs SERVER -> CLIENT messages: a ticket moved,
 * a new order arrived. Nothing flows the other way over the socket — advancing
 * a ticket is a normal authenticated PATCH. That is exactly the shape
 * Server-Sent Events were designed for, and SSE needs no dependency, no
 * handshake protocol, and reconnects on its own.
 *
 * WebSockets would be the right answer if the client had to push; here they
 * would be a heavier transport for a one-way problem.
 *
 * ── Scope limitation, stated plainly ───────────────────────────────────────
 * This bus lives in ONE Node process. Two instances behind a load balancer
 * would each only notify the clients connected to them, and a ticket advanced
 * on instance A would never reach a board attached to instance B.
 *
 * For one restaurant on one server that is fine and simple. If this is ever
 * scaled horizontally, the fix is to replace the emit path with Redis pub/sub
 * (or Mongo change streams) and leave every call site unchanged.
 */
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

export const EVENTS = Object.freeze({
  TICKET_CREATED: 'ticket:created',
  TICKET_ADVANCED: 'ticket:advanced',
  TICKET_RECALLED: 'ticket:recalled',
  ORDER_VOIDED: 'order:voided',
});

class Bus extends EventEmitter {}

const bus = new Bus();

// A busy service can have several boards, a couple of tills and the manager's
// dashboard all subscribed. The default cap of 10 would start printing leak
// warnings that are not leaks.
bus.setMaxListeners(100);

/**
 * Publish an event to every connected stream.
 *
 * Deliberately never throws. A failure to notify must not fail the write that
 * triggered it — the ticket has already advanced; the board can catch up on
 * its next reconnect or poll.
 *
 * @param {string} event one of EVENTS
 * @param {object} payload JSON-serialisable
 */
export function emitEvent(event, payload) {
  try {
    bus.emit(event, { event, at: new Date().toISOString(), ...payload });
  } catch (err) {
    logger.error('Failed to publish realtime event', { event, message: err.message });
  }
}

/**
 * Subscribe to every kitchen-relevant event.
 * @param {(payload: object) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeAll(handler) {
  const names = Object.values(EVENTS);
  for (const name of names) bus.on(name, handler);

  return () => {
    for (const name of names) bus.off(name, handler);
  };
}

/** Live subscriber count, for the health check and tests. */
export const listenerCount = () =>
  Object.values(EVENTS).reduce((total, name) => total + bus.listenerCount(name), 0);

export default bus;
