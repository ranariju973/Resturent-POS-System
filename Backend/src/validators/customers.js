/**
 * Customer request schemas.
 *
 * ── Everything here is PII ─────────────────────────────────────────────────
 * Name, phone and email identify a real person. Three consequences run through
 * this file and the controller:
 *
 *   • the logger's redaction list already strips `phone` and `email`, so these
 *     values never reach log storage
 *   • the search term is escaped before it becomes a RegExp (see the model) —
 *     a search box is the classic ReDoS entry point
 *   • pagination is mandatory and bounded, so no single request can dump the
 *     whole customer list
 */
import { z } from 'zod';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParamSchema = z.object({ id: objectId }).strict();

const name = z
  .string()
  .trim()
  .min(2, 'Name is too short')
  .max(80, 'Name is too long');

/**
 * Phone. Permissive about formatting, strict about content.
 *
 * People write numbers as '+91 98200 41122', '(982) 004-1122' or
 * '9820041122', and refusing any of those would just make staff fight the
 * form. The model normalises to digits for uniqueness, so all three resolve to
 * the same person rather than silently creating duplicates.
 */
const phone = z
  .string()
  .trim()
  .min(6, 'Phone number is too short')
  .max(24, 'Phone number is too long')
  .regex(/^[+]?[\d\s()-]+$/, 'Phone number may contain only digits, spaces and + ( ) -')
  .refine((v) => v.replace(/\D/g, '').length >= 6, {
    message: 'Phone number needs at least 6 digits',
  });

/** Optional. Empty string is a legitimate "not given", not a validation error. */
const email = z
  .string()
  .trim()
  .max(254, 'Email is too long')
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: 'Invalid email address',
  });

/** Allergies, seating preferences. Length-capped free text. */
const notes = z.string().trim().max(500, 'Notes are too long');

/**
 * Phone lookup query.
 *
 * Reuses the same `phone` rules as creation on purpose: the lookup must accept
 * exactly what the create form accepts, or a number that saved fine would fail
 * to find itself afterwards.
 */
export const lookupSchema = z.object({ phone }).strict();

/**
 * Type-ahead suggestions for the billing screen.
 *
 * Deliberately its own schema with a LOWER floor than `lookupSchema` — four
 * digits, because that is where a suggestion list becomes useful. That is also
 * what makes it the more dangerous of the two endpoints: a prefix search can be
 * walked, where an exact match cannot. The controller compensates by capping
 * results, masking the middle of each number, and sharing the lookup rate
 * limiter. See the note there before loosening any of it.
 */
export const suggestSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(4, 'Type at least 4 digits')
      .max(24, 'Phone number is too long')
      .regex(/^[+]?[\d\s()-]+$/, 'Phone number may contain only digits, spaces and + ( ) -'),
  })
  .strict();

export const createCustomerSchema = z
  .object({
    name,
    phone,
    email: email.optional().default(''),
    notes: notes.optional().default(''),
  })
  .strict();

export const updateCustomerSchema = z
  .object({
    name: name.optional(),
    phone: phone.optional(),
    email: email.optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export const listCustomersSchema = z
  .object({
    /**
     * Matches the start of a name, or the start of the digits of a phone.
     * Capped at 80 characters — a longer "search" is not a search.
     */
    search: z.string().trim().max(80, 'Search term is too long').optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    skip: z.coerce.number().int().min(0).max(10_000).optional().default(0),
    sort: z.enum(['recent', 'name', 'visits']).optional().default('recent'),
  })
  .strict();

/** Order history for one customer. Always paginated — see the controller. */
export const historySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    skip: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  })
  .strict();

/**
 * Deletion.
 *
 * `erase` requests a genuine PII scrub rather than a soft delete — see the
 * controller for what that does and why it is a separate, irreversible thing.
 */
export const deleteCustomerSchema = z
  .object({
    erase: z.enum(['true', 'false']).optional(),
  })
  .strict();

export default {
  lookupSchema,
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
  historySchema,
  deleteCustomerSchema,
  idParamSchema,
};
