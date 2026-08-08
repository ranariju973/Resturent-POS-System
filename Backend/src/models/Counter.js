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
export async function nextSequence(name, options = {}) {
  const { seq } = await nextSequenceWithDay(name, options);
  return seq;
}

/**
 * The same sequence, plus the service day the counter was keyed on.
 *
 * ── Why the day has to come back out ───────────────────────────────────────
 * An invoice number embeds the date: `INV-20260806-0041`. The obvious way to
 * build it is to format the order's `createdAt` — and that is a bug that fires
 * once a year, at 23:59:59.
 *
 * `serviceDayKey()` is read HERE to pick the counter document. A caller that
 * separately formats its own `new Date()` a few milliseconds later can land on
 * the next day, producing `INV-20260807-0041` from the `order:2026-08-06`
 * counter — and tomorrow's genuine #41 then collides on the unique index.
 *
 * Returning the exact string this function used makes the number and the
 * counter that produced it the same day by construction, so the two cannot
 * disagree no matter where the clock falls.
 *
 * @param {string} name
 * @param {object} [options] Same as nextSequence.
 * @returns {Promise<{ seq: number, day: string }>} `day` is 'YYYY-MM-DD'.
 */
export async function nextSequenceWithDay(name, { daily = true, start = 1, session } = {}) {
  // Read once. Everything below uses this value, never a fresh clock read.
  const day = serviceDayKey();
  const key = daily ? `${name}:${day}` : name;

  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session },
  );

  return { seq: doc.seq + (start - 1), day };
}

export { Counter };
export default Counter;
