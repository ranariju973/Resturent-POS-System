/**
 * Atomic sequence generator for human-facing numbers (order #41, ticket #42).
 *
 * The obvious implementation — `count() + 1` — is a race: two cashiers ringing
 * up at the same moment both read 40 and both write 41. findOneAndUpdate with
 * $inc is a single atomic document operation, so every caller gets a distinct
 * value even under concurrency.
 *
 * Sequences reset daily by default: order numbers restart at 1 each service
 * day, which is what staff expect when they call out "order 41" across a
 * counter. The scope key carries the date, so yesterday's counter is simply a
 * different document.
 */
import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    // e.g. 'order:2026-08-04' or 'ticket:2026-08-04'
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

const Counter = mongoose.model('Counter', counterSchema);

/** YYYY-MM-DD in the server's local timezone — the service-day boundary. */
export function serviceDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Next value in a sequence. Atomic and safe to call concurrently.
 *
 * @param {string} name        Sequence name, e.g. 'order'
 * @param {object} [options]
 * @param {boolean} [options.daily=true]  Reset the sequence each service day
 * @param {number}  [options.start=1]     First value returned
 * @param {import('mongoose').ClientSession} [options.session] Pass the session
 *        when called inside a transaction (Phase 7 creates an Order and its
 *        Ticket together and must not half-commit).
 * @returns {Promise<number>}
 */
export async function nextSequence(name, { daily = true, start = 1, session } = {}) {
  const key = daily ? `${name}:${serviceDayKey()}` : name;

  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session },
  );

  return doc.seq + (start - 1);
}

export { Counter };
export default Counter;
