/**
 * Public invoice request schema.
 *
 * This is the only validator on an unauthenticated route, so it is the whole
 * input surface a stranger can reach. It is deliberately narrow: one path
 * parameter, matched against a fixed shape, `.strict()` so nothing else rides
 * along.
 */
import { z } from 'zod';

/**
 * `INV-YYYYMMDD-NNNN-<token>`.
 *
 * The token is base64url — letters, digits, `-` and `_` — and is bounded at
 * both ends so a megabyte of path never reaches the database. The exact
 * split between number and token happens in utils/invoiceLink.js; this only
 * establishes that the thing is well-formed before any query runs.
 */
export const invoiceSlugSchema = z
  .object({
    slug: z
      .string()
      .regex(
        /^INV-\d{8}-\d{4}-[A-Za-z0-9_-]{16,64}$/,
        'Not a valid invoice link',
      ),
  })
  .strict();

export default { invoiceSlugSchema };
