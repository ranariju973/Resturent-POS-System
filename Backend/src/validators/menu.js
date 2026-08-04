/**
 * Menu and category request schemas.
 *
 * ── The price boundary ─────────────────────────────────────────────────────
 * Requests carry `price` in MAJOR units — 4.25 — because that is what a person
 * types into a form and what the frontend already works in. The schema
 * converts it to `priceMinor` here, at the edge, so everything past this point
 * deals in integers and nothing downstream has to remember which unit it is
 * holding. See src/utils/money.js for why storage is integral.
 *
 * Two decimal places maximum: 4.255 is not a price anyone can charge, and
 * accepting it would mean silently rounding a value the admin typed.
 *
 * Every schema is `.strict()`. Unknown keys are rejected, not stripped.
 */
import { z } from 'zod';
import { toMinor } from '../utils/money.js';

/** Mongo ObjectId, for path params. */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const idParamSchema = z.object({ id: objectId }).strict();

/**
 * Price in major units.
 *
 * Multipart bodies arrive as strings, so this coerces. `.refine` runs on the
 * ORIGINAL text where possible, which is how the two-decimal rule is enforced
 * before any float rounding can hide a third decimal.
 */
const priceMajor = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const text = String(v).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Price must be a number with at most 2 decimal places',
      });
      return z.NEVER;
    }
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Price must be greater than zero' });
      return z.NEVER;
    }
    if (n > 100_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Price is implausibly large' });
      return z.NEVER;
    }
    return toMinor(n);
  });

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex value like #00754A');

const itemName = z.string().trim().min(2, 'Name is too short').max(80, 'Name is too long');
const description = z.string().trim().max(300, 'Description is too long');

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

/**
 * Create. Multipart, so scalars arrive as strings — hence the coercions.
 * The image itself is handled by multer, not by this schema.
 */
export const createItemSchema = z
  .object({
    name: itemName,
    price: priceMajor,
    category: objectId,
    description: description.optional().default(''),
    // Checkbox values arrive as the strings 'true'/'false' over multipart.
    available: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .default(true)
      .transform((v) => v === true || v === 'true'),
  })
  .strict()
  // Rename on the way out: the request field is `price` (major units), the
  // parsed field is `priceMinor` (integer). Keeping the name `price` on a
  // value that is now 425 rather than 4.25 is exactly the ambiguity the
  // naming convention exists to prevent.
  .transform(({ price, ...rest }) => ({ ...rest, priceMinor: price }));

/** Update. Every field optional, but at least one must be present. */
export const updateItemSchema = z
  .object({
    name: itemName.optional(),
    price: priceMajor.optional(),
    category: objectId.optional(),
    description: description.optional(),
    available: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
    /**
     * Explicitly clear the image without uploading a replacement.
     *
     * The `undefined` guard matters: without it the transform turns "absent"
     * into `false`, the key is always present in the parsed body, and the
     * "at least one field" check below can never fail — an empty PUT would be
     * accepted as a valid no-op update.
     */
    removeImage: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  })
  .strict()
  .refine((body) => Object.keys(body).some((k) => body[k] !== undefined), {
    message: 'No fields to update',
  })
  // Same rename as create. `priceMinor` is absent when price was not supplied.
  .transform(({ price, ...rest }) => (price === undefined ? rest : { ...rest, priceMinor: price }));

/**
 * The stock toggle — the one menu write a cashier or kitchen staffer holds.
 *
 * Deliberately the narrowest schema in the codebase: exactly one boolean.
 * `.strict()` means a client that also sends `price` or `category` gets a 400
 * rather than having the extra field quietly dropped, so an attempt to widen
 * this endpoint shows up in the logs instead of succeeding silently.
 */
export const availabilitySchema = z.object({ available: z.boolean() }).strict();

/** List filters. All optional, all bounded. */
export const listItemsSchema = z
  .object({
    category: objectId.optional(),
    available: z.enum(['true', 'false']).optional(),
    search: z.string().trim().max(80).optional(),
    // Menus are small, but an unbounded limit is still a free way to make the
    // server assemble an arbitrarily large response.
    limit: z.coerce.number().int().min(1).max(200).optional().default(200),
    // Admin-only view of soft-deleted items; ignored for other roles in the
    // controller, which is where the permission is known.
    includeInactive: z.enum(['true', 'false']).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(40, 'Name is too long'),
    color: hexColor.optional().default('#00754A'),
    sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(40).optional(),
    color: hexColor.optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export default {
  createItemSchema,
  updateItemSchema,
  availabilitySchema,
  listItemsSchema,
  createCategorySchema,
  updateCategorySchema,
  idParamSchema,
};
