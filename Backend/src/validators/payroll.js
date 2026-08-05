/**
 * Payroll request schemas.
 *
 * The route key is (employee, month) rather than a payroll id, because for most
 * months no row exists yet — an untouched month is computed on the fly, not
 * stored. Addressing by id would mean the client could only adjust months that
 * had already been adjusted.
 */
import { z } from 'zod';
import { toMinor } from '../utils/money.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** YYYY-MM. */
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

export const payrollMonthSchema = z
  .object({
    month: isoMonth,
    employee: objectId.optional(),
  })
  .strict();

/** The (employee, month) pair that identifies a row, stored or not. */
export const payrollKeyParamsSchema = z
  .object({
    employeeId: objectId,
    month: isoMonth,
  })
  .strict();

/**
 * A bonus or deduction in MAJOR units, converted at the boundary.
 *
 * Zero is meaningful — it is how an admin clears an adjustment they entered by
 * mistake — so unlike an expense amount this does not insist on a positive
 * number.
 */
const adjustmentMajor = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const text = String(v).trim();
  if (text === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Amount must be a number with at most 2 decimal places',
    });
    return z.NEVER;
  }
  const n = Number(text);
  if (n > 10_000_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is implausibly large' });
    return z.NEVER;
  }
  return toMinor(n);
});

export const adjustPayrollSchema = z
  .object({
    bonus: adjustmentMajor.optional(),
    deduction: adjustmentMajor.optional(),
    notes: z.string().trim().max(300, 'Notes are too long').optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' })
  .transform(({ bonus, deduction, ...rest }) => ({
    ...rest,
    ...(bonus === undefined ? {} : { bonusMinor: bonus }),
    ...(deduction === undefined ? {} : { deductionMinor: deduction }),
  }));

export const markPaidSchema = z
  .object({
    notes: z.string().trim().max(300, 'Notes are too long').optional().default(''),
  })
  .strict();

export default {
  payrollMonthSchema,
  payrollKeyParamsSchema,
  adjustPayrollSchema,
  markPaidSchema,
};
