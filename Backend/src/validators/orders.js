/**
 * Order request schemas.
 *
 * ── The client's entire vocabulary is ids and quantities ───────────────────
 * There is no `price` field here. No `subtotal`, no `total`, no `priceMinor`.
 * A client cannot express a price in this API, which is the cleanest possible
 * way to guarantee it cannot set one: the schema rejects the key outright, the
 * controller reads prices from the database, and `Order.recalculate()` derives
 * every total from the lines. Three layers, and the first one is "the word
 * does not exist".
 *
 * The discount endpoints are the exception — a discount IS a number the
 * cashier chooses — and they are correspondingly the most guarded, with a
 * ceiling and a manager-override path.
 */
import { z } from 'zod';
import {
  ORDER_TYPE_VALUES,
  PAYMENT_METHOD_VALUES,
  DISCOUNT_TYPE,
  ORDER_STATUS_VALUES,
} from '../constants/enums.js';
import { toMinor } from '../utils/money.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParamSchema = z.object({ id: objectId }).strict();

/**
 * A single cart line. Note what is absent.
 * `qty` is capped: 999 of one dish is a fat-fingered keypad, not an order.
 */
const orderLine = z
  .object({
    menuItemId: objectId,
    qty: z.coerce
      .number()
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1')
      .max(999, 'Quantity is implausibly large'),
    note: z.string().trim().max(200, 'Note is too long').optional().default(''),
  })
  .strict();

const items = z
  .array(orderLine)
  .min(1, 'An order must contain at least one item')
  // Bounded so one request cannot ask the server to price a thousand lines.
  .max(100, 'Too many distinct items in one order');

/**
 * A customer captured at the till, keyed by phone.
 *
 * The phone number is the identity: the model already holds a unique index on
 * its normalised form, so the same person entered as '+91 98200 41122' at one
 * terminal and '9820041122' at another resolves to one record rather than two.
 *
 * `name` is optional here because a returning customer already has one stored.
 * The controller requires it only when the number is unknown — see the note
 * there for why an unnamed new customer is refused rather than filed as
 * "Guest".
 */
const inlineCustomer = z
  .object({
    phone: z
      .string()
      .trim()
      .min(6, 'Phone number is too short')
      .max(24, 'Phone number is too long')
      .regex(/^[+]?[\d\s()-]+$/, 'Phone number may contain only digits, spaces and + ( ) -')
      .refine((v) => v.replace(/\D/g, '').length >= 6, {
        message: 'Phone number needs at least 6 digits',
      }),
    name: z.string().trim().min(2, 'Name is too short').max(80, 'Name is too long').optional(),
  })
  .strict();

/**
 * Apply or clear a discount.
 *
 * `value` means percent when type is 'percent', and MAJOR currency units when
 * 'fixed' — 2.50, not 250. It is converted to minor units here so the
 * controller and the ceiling check both work in integers.
 *
 * `adminOverridePin` is the manager-approval path for a discount above the
 * cashier ceiling. Absent on ordinary discounts.
 *
 * Declared above createOrderSchema because that schema embeds it — a const is
 * in its temporal dead zone until evaluated, so a forward reference here would
 * throw at import rather than at request time.
 */
export const discountSchema = z
  .object({
    type: z.enum([DISCOUNT_TYPE.PERCENT, DISCOUNT_TYPE.FIXED]).nullable(),
    value: z.union([z.number(), z.string()]).optional(),
    adminOverridePin: z
      .string()
      .regex(/^\d{4}$/, 'Override PIN must be 4 digits')
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.type === null) return; // clearing the discount needs no value
    if (body.value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A discount needs a value', path: ['value'] });
    }
  })
  .transform((body, ctx) => {
    if (body.type === null) return { type: null, valueMinor: 0, percent: 0, adminOverridePin: body.adminOverridePin };

    const text = String(body.value).trim();

    if (body.type === DISCOUNT_TYPE.PERCENT) {
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid percentage', path: ['value'] });
        return z.NEVER;
      }
      const percent = Number(text);
      if (percent <= 0 || percent > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Percentage must be between 0 and 100',
          path: ['value'],
        });
        return z.NEVER;
      }
      return { type: DISCOUNT_TYPE.PERCENT, percent, valueMinor: 0, adminOverridePin: body.adminOverridePin };
    }

    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be a number with at most 2 decimal places',
        path: ['value'],
      });
      return z.NEVER;
    }
    const amount = Number(text);
    if (amount <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be greater than zero', path: ['value'] });
      return z.NEVER;
    }
    return { type: DISCOUNT_TYPE.FIXED, valueMinor: toMinor(amount), percent: 0, adminOverridePin: body.adminOverridePin };
  });

export const createOrderSchema = z
  .object({
    type: z.enum(ORDER_TYPE_VALUES, { errorMap: () => ({ message: 'Invalid order type' }) }),
    tableId: objectId.optional(),
    customerId: objectId.optional(),
    customer: inlineCustomer.optional(),
    items,
    /*
     * An opening discount, so the till does not have to POST the order and
     * then immediately PATCH a discount onto it.
     *
     * Reuses discountSchema rather than restating its shape: the percent/fixed
     * parsing, the two-decimal rule and the override-PIN format are all rules
     * about what a discount IS, and they should not be able to differ
     * depending on which endpoint the discount arrived through.
     *
     * `type: null` is permitted by that schema (it is how the other endpoint
     * clears a discount) and simply means "no discount" here.
     */
    discount: discountSchema.optional(),
  })
  .strict()
  // Both would be two different answers to "who is this order for". Rather
  // than silently picking one, refuse — a client sending both has a bug, and
  // resolving it quietly means shipping that bug attached to someone's bill.
  .refine((body) => !(body.customerId && body.customer), {
    message: 'Send either customerId or customer, not both',
    path: ['customer'],
  })
  // A dine-in order without a table has nowhere to be served; a takeaway with
  // one blocks a table that nobody is sitting at.
  .refine((body) => body.type !== 'dine-in' || Boolean(body.tableId), {
    message: 'A dine-in order needs a table',
    path: ['tableId'],
  })
  .refine((body) => body.type === 'dine-in' || !body.tableId, {
    message: 'Only dine-in orders may be attached to a table',
    path: ['tableId'],
  });

/** Replace the lines on an open order — the cart being edited. */
export const updateItemsSchema = z.object({ items }).strict();

/** Settle the bill. */
export const paySchema = z
  .object({
    paymentMethod: z.enum(PAYMENT_METHOD_VALUES, {
      errorMap: () => ({ message: 'Invalid payment method' }),
    }),
    customerId: objectId.optional(),
  })
  .strict();

/**
 * Void an order.
 *
 * A reason is mandatory. A void with no explanation is indistinguishable in
 * the audit log from theft, and requiring one costs the honest cashier five
 * seconds.
 */
export const voidSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, 'A reason is required')
      .max(200, 'Reason is too long'),
    adminOverridePin: z
      .string()
      .regex(/^\d{4}$/, 'Override PIN must be 4 digits')
      .optional(),
  })
  .strict();

/**
 * Permanently delete an order.
 *
 * The reason is mandatory and longer than a void's, because this is the more
 * destructive of the two and the audit entry is all that survives it. A void
 * at least leaves the order behind to be inspected; this leaves one log line.
 */
export const deleteOrderSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'Explain why this order is being permanently deleted')
      .max(200, 'Reason is too long'),
  })
  .strict();

/** List filters. Bounded, and date-range-capped in the controller. */
export const listOrdersSchema = z
  .object({
    status: z.enum(ORDER_STATUS_VALUES).optional(),
    type: z.enum(ORDER_TYPE_VALUES).optional(),
    tableId: objectId.optional(),
    customerId: objectId.optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    skip: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  })
  .strict();

export default {
  createOrderSchema,
  updateItemsSchema,
  discountSchema,
  paySchema,
  voidSchema,
  deleteOrderSchema,
  listOrdersSchema,
  idParamSchema,
};
