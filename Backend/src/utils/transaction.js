/**
 * Multi-document transactions.
 *
 * ── Why orders need them ───────────────────────────────────────────────────
 * Placing an order writes three documents: the Order, its kitchen Ticket, and
 * the Table it is attached to. Any partial success is a broken restaurant:
 *
 *   order without ticket  — the customer is charged, the kitchen never cooks
 *   ticket without order  — food goes out, nothing is billed
 *   table not linked      — the bill exists but no terminal can find it
 *
 * ── The replica-set requirement ────────────────────────────────────────────
 * MongoDB transactions need a replica set. Atlas gives you one on every tier
 * including the free one, so production is fine. A bare local `mongod` started
 * for development is a standalone and does NOT support them — the driver
 * throws "Transaction numbers are only allowed on a replica set member".
 *
 * Crashing every write in development would be unhelpful; silently dropping
 * the atomicity guarantee would be worse. So this detects the topology once,
 * warns loudly and repeatedly enough to be noticed, and continues without a
 * session — while making it unmistakable in the logs that the guarantee is
 * absent on that machine.
 */
import mongoose from 'mongoose';
import { logger } from './logger.js';

/** null = not yet determined. */
let transactionsSupported = null;
let warned = false;

/** Detect once. The error is thrown at commit time, so this probes cheaply. */
async function detectSupport() {
  if (transactionsSupported !== null) return transactionsSupported;

  try {
    const { setName, msg } = mongoose.connection.db
      ? await mongoose.connection.db.admin().command({ hello: 1 })
      : {};
    // `setName` is present on a replica set member; `msg: 'isdbgrid'` on a
    // sharded cluster through mongos. Either supports transactions.
    transactionsSupported = Boolean(setName) || msg === 'isdbgrid';
  } catch (err) {
    logger.warn('Could not determine MongoDB topology — assuming no transactions', {
      message: err.message,
    });
    transactionsSupported = false;
  }

  if (!transactionsSupported && !warned) {
    warned = true;
    logger.warn(
      'MongoDB is a STANDALONE — multi-document transactions are unavailable. ' +
        'Order writes will not be atomic: a failure partway through can leave an order ' +
        'without its kitchen ticket. Use a replica set (Atlas provides one on every tier) ' +
        'before running real service.',
    );
  }

  return transactionsSupported;
}

/**
 * Run `fn` inside a transaction when the deployment supports one.
 *
 * `fn` receives a session (or null) and MUST pass it to every write it makes,
 * or those writes fall outside the transaction and the guarantee is void.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession|null) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const supported = await detectSupport();

  if (!supported) {
    // Degraded path. Already warned above; the caller's logic is unchanged.
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Exposed for the health check and tests. */
export const transactionsAvailable = () => transactionsSupported;

/** Test hook — forces re-detection. */
export function resetTransactionSupport() {
  transactionsSupported = null;
  warned = false;
}

export default withTransaction;
