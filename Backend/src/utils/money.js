/**
 * Money handling.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONVENTION: every monetary value in the database is an INTEGER number of
 * minor units (cents / paise). Never a float.
 *
 *   $4.25  ->  425
 *   ₹1840.50 -> 184050
 *
 * Field names carry the unit — `priceMinor`, `subtotalMinor`, `totalMinor` —
 * so no call site has to guess. If a field name lacks the `Minor` suffix it
 * is not money.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Why: 0.1 + 0.2 !== 0.3 in IEEE-754. A POS adds prices, applies percentage
 * discounts and splits bills all day; float drift shows up as receipts that
 * are a cent off and a till that never reconciles. Integers make every
 * operation exact except division, which is the one place we round explicitly.
 */

const MINOR_UNITS_PER_MAJOR = 100;

/** True for a safe, non-negative integer — what every money field must be. */
export const isValidMinor = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Major units (4.25) -> minor units (425).
 * Uses a rounded string conversion because 4.25 * 100 can land on 424.99999.
 * @param {number|string} major
 * @returns {number}
 */
export function toMinor(major) {
  const n = typeof major === 'string' ? Number(major) : major;
  if (!Number.isFinite(n)) throw new TypeError(`Cannot convert "${major}" to minor units`);
  return Math.round(n * MINOR_UNITS_PER_MAJOR);
}

/**
 * Minor units (425) -> major units (4.25), for display/serialisation only.
 * Never feed the result back into arithmetic.
 * @param {number} minor
 * @returns {number}
 */
export function toMajor(minor) {
  if (!Number.isFinite(minor)) throw new TypeError(`Cannot convert "${minor}" to major units`);
  return minor / MINOR_UNITS_PER_MAJOR;
}

/**
 * Percentage of an amount, rounded half-up to the nearest minor unit.
 * Used for discounts and tax. Rounding happens exactly once, here.
 * @param {number} amountMinor
 * @param {number} percent e.g. 12.5 for 12.5%
 * @returns {number}
 */
export function percentOf(amountMinor, percent) {
  if (!isValidMinor(amountMinor)) throw new TypeError('amountMinor must be a non-negative integer');
  if (!Number.isFinite(percent) || percent < 0) throw new TypeError('percent must be >= 0');
  return Math.round((amountMinor * percent) / 100);
}

/** Sum a list of minor-unit amounts. Exact — no accumulation error. */
export const sumMinor = (amounts) => amounts.reduce((total, a) => total + a, 0);

/** Line total for qty x unit price. Exact, because both operands are integers. */
export function lineTotalMinor(unitPriceMinor, qty) {
  if (!isValidMinor(unitPriceMinor)) throw new TypeError('unitPriceMinor must be a non-negative integer');
  if (!Number.isSafeInteger(qty) || qty < 1) throw new TypeError('qty must be a positive integer');
  return unitPriceMinor * qty;
}

/**
 * Split an amount n ways with the remainder distributed one minor unit at a
 * time, so the parts always add back up to the original.
 * Split-bill (Phase 6) uses this — naive division loses or invents cents.
 * @param {number} amountMinor
 * @param {number} ways
 * @returns {number[]}
 */
export function splitMinor(amountMinor, ways) {
  if (!isValidMinor(amountMinor)) throw new TypeError('amountMinor must be a non-negative integer');
  if (!Number.isSafeInteger(ways) || ways < 1) throw new TypeError('ways must be a positive integer');

  const base = Math.floor(amountMinor / ways);
  const remainder = amountMinor - base * ways;
  return Array.from({ length: ways }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Mongoose field definition for a money column. Spread into a schema path. */
export const minorField = (extra = {}) => ({
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: isValidMinor,
    message: (props) => `${props.path} must be a non-negative integer in minor units`,
  },
  ...extra,
});

export default {
  toMinor,
  toMajor,
  percentOf,
  sumMinor,
  lineTotalMinor,
  splitMinor,
  isValidMinor,
  minorField,
};
