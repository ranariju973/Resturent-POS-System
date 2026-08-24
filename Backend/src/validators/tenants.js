/**
 * Restaurant schemas.
 *
 * Every schema is `.strict()` — unknown keys are rejected, not stripped.
 */
import { z } from 'zod';

/**
 * Naming a restaurant, at onboarding.
 *
 * Only the name. Everything else about a restaurant — address, tax number,
 * receipt footer — is editable afterwards from the settings screen, and asking
 * for it on the very first screen someone sees would trade a working till
 * today for a complete record they can fill in whenever they like.
 */
export const createTenantSchema = z
  .object({
    name: z
      .string({ required_error: 'Restaurant name is required' })
      .trim()
      .min(2, 'Restaurant name must be at least 2 characters')
      .max(80, 'Restaurant name cannot exceed 80 characters'),
  })
  .strict();

/**
 * Editing the restaurant's identity.
 *
 * Every field optional, so a form that submits one changed box leaves the rest
 * alone rather than clearing them. `slug` is deliberately absent: it is
 * derived once at creation and never auto-updated, because a rename must not
 * silently break a URL somebody bookmarked.
 */
export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    tagline: z.string().trim().max(120).optional(),
    address: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(24).optional(),
    gstNumber: z.string().trim().max(20).optional(),
    footerLine: z.string().trim().max(120).optional(),
  })
  .strict();

export default { createTenantSchema, updateTenantSchema };
