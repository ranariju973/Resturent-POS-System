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
const terminalName = z
  .string({ required_error: 'Terminal name is required' })
  .trim()
  .min(2, 'Terminal name must be at least 2 characters')
  .max(60, 'Terminal name cannot exceed 60 characters');

export const linkDeviceSchema = z.object({ name: terminalName }).strict();

/**
 * Renaming a terminal.
 *
 * The name is the only thing that can change. A terminal's identity is its
 * token, which is minted server-side and never accepted from a caller — so
 * there is deliberately nothing else here to send.
 */
export const renameDeviceSchema = z.object({ name: terminalName }).strict();

/**
 * Re-linking takes no body at all.
 *
 * WHICH terminal is the path parameter, and WHICH browser is the request
 * itself. Declared rather than omitted so a stray key is a 400 rather than
 * something quietly ignored.
 */
export const relinkDeviceSchema = z.object({}).strict();

/** A Mongo ObjectId in the path. */
export const deviceIdParamSchema = z
  .object({
    id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
  })
  .strict();

/** Endpoints that take nothing. Declared so a stray key is a 400, not ignored. */
export const emptyQuerySchema = z.object({}).strict();

export default {
  linkDeviceSchema,
  renameDeviceSchema,
  relinkDeviceSchema,
  deviceIdParamSchema,
  emptyQuerySchema,
};
