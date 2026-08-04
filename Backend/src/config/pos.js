/**
 * POS business rules.
 *
 * These are policy, not mechanism — the numbers a restaurant owner would want
 * to change without reading any other file. They live here rather than being
 * scattered as literals through the order controller.
 */

/**
 * The largest percentage discount a cashier may apply unaided.
 *
 * Above this, the request needs `pos:override` (admin) or a manager's override
 * PIN entered at the terminal. Comped meals and staff discounts are exactly
 * where till fraud happens, so the ceiling is low enough that the routine
 * gestures — a 10% apology for a slow kitchen — stay frictionless, while
 * anything approaching "free" needs a second person.
 */
export const CASHIER_MAX_DISCOUNT_PERCENT = 20;

/**
 * The largest fixed discount a cashier may apply unaided, in minor units.
 * A percentage ceiling alone is not enough: 20% of a large party's bill is a
 * lot of money, and a fixed amount sidesteps the percentage check entirely.
 */
export const CASHIER_MAX_DISCOUNT_MINOR = 2000; // $20.00

/**
 * Default tax rate, as a percentage.
 *
 * Zero by design. The frontend reserves a tax row but computes nothing, and
 * inventing a rate here would put a wrong number on a real receipt. Set it
 * when the actual rate is known; `Order.recalculate()` already applies tax
 * after the discount.
 */
export const DEFAULT_TAX_RATE = 0;

/**
 * How long after payment an order may still be voided by a cashier holding an
 * override, in minutes. Beyond this it is an admin-only correction.
 *
 * The reasoning: a void a minute after payment is a mistake being fixed. A
 * void two hours later, after the customer has gone, is a different act and
 * deserves a different level of authority.
 */
export const CASHIER_VOID_WINDOW_MINUTES = 30;

export default {
  CASHIER_MAX_DISCOUNT_PERCENT,
  CASHIER_MAX_DISCOUNT_MINOR,
  DEFAULT_TAX_RATE,
  CASHIER_VOID_WINDOW_MINUTES,
};
