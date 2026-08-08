/**
 * Printer settings request schemas.
 *
 * Every field is optional and merged server-side, so a client that submits a
 * partial form does not blank the fields it left out. `.strict()` still
 * applies — optional means "may be omitted", not "anything goes".
 */
import { z } from 'zod';
import { PAPER_WIDTHS } from '../models/PrinterSettings.js';

/**
 * The GET takes nothing.
 *
 * Declared rather than omitted so route-coverage's validation sweep passes
 * honestly instead of via its exemption list — and it means `?debug=1` is a
 * 400 rather than something silently ignored. Same pattern as dashboardSchema.
 */
export const printerSettingsQuerySchema = z.object({}).strict();

/** Free text printed on a receipt. Angle brackets have no business here. */
const receiptText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[<>]/.test(v), { message: 'Angle brackets are not allowed' });

export const updatePrinterSettingsSchema = z
  .object({
    // Coerced because a <select> hands back a string.
    paperWidth: z.coerce
      .number()
      .refine((v) => PAPER_WIDTHS.includes(v), {
        message: `Paper width must be one of ${PAPER_WIDTHS.join(', ')}mm`,
      })
      .optional(),

    // Bounded at 5: a typo'd 50 would empty a paper roll before anyone could
    // reach the printer.
    billCopies: z.coerce.number().int().min(1).max(5).optional(),
    kotCopies: z.coerce.number().int().min(1).max(5).optional(),

    kotPrinterName: z.string().trim().max(120).optional(),
    billPrinterName: z.string().trim().max(120).optional(),

    businessName: receiptText(80).optional(),
    businessAddress: receiptText(200).optional(),
    businessPhone: receiptText(24).optional(),
    gstNumber: receiptText(20).optional(),
    footerLine: receiptText(120).optional(),
  })
  .strict();

export default { printerSettingsQuerySchema, updatePrinterSettingsSchema };
