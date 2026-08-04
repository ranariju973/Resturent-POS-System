/**
 * Dashboard and report request schemas.
 *
 * ── Every date range is capped ─────────────────────────────────────────────
 * An unvalidated range is the cheapest way to make this server do expensive
 * work: `?from=1970-01-01&to=2099-12-31` turns an indexed range scan into a
 * full collection scan, and the caller only has to type it once. Each schema
 * below bounds both the format and the span.
 */
import { z } from 'zod';
import { EXPENSE_CATEGORY_VALUES } from '../constants/enums.js';
import { toMinor } from '../utils/money.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParamSchema = z.object({ id: objectId }).strict();

/** YYYY-MM-DD, and a real date — '2026-02-31' parses but is not a day. */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

/** YYYY-MM. */
const isoMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

/**
 * The dashboard takes no parameters at all.
 *
 * This is the enforcement point for the cashier restriction. If the endpoint
 * accepted `?range=month` or `?from=…`, the shaping in the controller would be
 * one forgotten branch away from handing a cashier the full picture. With no
 * inputs, "today" is not a default that can be overridden — it is the only
 * thing the endpoint can mean.
 */
export const dashboardSchema = z.object({}).strict();

export const dailyReportSchema = z
  .object({
    date: isoDay.optional(),
  })
  .strict();

export const monthlyReportSchema = z
  .object({
    month: isoMonth.optional(),
  })
  .strict();

/** Free-range queries, span-capped. */
export const rangeSchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
  })
  .strict()
  .refine((b) => !(b.from && b.to) || b.from <= b.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export const expenseListSchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    category: z.enum(EXPENSE_CATEGORY_VALUES).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(100),
    skip: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  })
  .strict()
  .refine((b) => !(b.from && b.to) || b.from <= b.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

/**
 * Recording an expense.
 *
 * `amount` is in MAJOR units, converted here — the same boundary rule the menu
 * uses. The parsed field is renamed to `amountMinor` so nothing downstream has
 * to remember which unit it is holding.
 */
export const createExpenseSchema = z
  .object({
    date: isoDay,
    category: z.enum(EXPENSE_CATEGORY_VALUES, {
      errorMap: () => ({ message: 'Invalid expense category' }),
    }),
    description: z.string().trim().min(2, 'Description is too short').max(200),
    amount: z.union([z.number(), z.string()]).transform((v, ctx) => {
      const text = String(v).trim();
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Amount must be a number with at most 2 decimal places',
        });
        return z.NEVER;
      }
      const n = Number(text);
      if (n <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be greater than zero' });
        return z.NEVER;
      }
      if (n > 10_000_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is implausibly large' });
        return z.NEVER;
      }
      return toMinor(n);
    }),
  })
  .strict()
  .transform(({ amount, ...rest }) => ({ ...rest, amountMinor: amount }));

export default {
  dashboardSchema,
  dailyReportSchema,
  monthlyReportSchema,
  rangeSchema,
  expenseListSchema,
  createExpenseSchema,
  idParamSchema,
};
