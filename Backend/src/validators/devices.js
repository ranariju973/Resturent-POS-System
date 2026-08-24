/**
 * Terminal schemas.
 *
 * Every schema is `.strict()` — unknown keys are rejected, not stripped.
 */
import { z } from 'zod';

/**
 * Linking a terminal.
 *
 * The name is the only input. The token is minted server-side and returned as
 * an httpOnly cookie, so there is deliberately no way for a client to propose
 * one — a caller-supplied device token would be a caller-supplied answer to
 * "which restaurant is this?", which is the one question this whole mechanism
 * exists to answer authoritatively.
 */
export const linkDeviceSchema = z
  .object({
    name: z
      .string({ required_error: 'Terminal name is required' })
      .trim()
      .min(2, 'Terminal name must be at least 2 characters')
      .max(60, 'Terminal name cannot exceed 60 characters'),
  })
  .strict();

/** A Mongo ObjectId in the path. */
export const deviceIdParamSchema = z
  .object({
    id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
  })
  .strict();

/** Endpoints that take nothing. Declared so a stray key is a 400, not ignored. */
export const emptyQuerySchema = z.object({}).strict();

export default { linkDeviceSchema, deviceIdParamSchema, emptyQuerySchema };
