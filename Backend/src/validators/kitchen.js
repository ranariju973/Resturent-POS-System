/**
 * Kitchen request schemas.
 *
 * ── The important absence ──────────────────────────────────────────────────
 * The advance endpoint takes NO BODY. Not a target status, not a "from"
 * status, nothing.
 *
 * The destination is derived server-side from what is stored, via
 * NEXT_TICKET_STATUS. If the client could name a target, it could send
 * `{status: 'served'}` on a pending ticket and mark food served that was never
 * cooked — the kitchen board would clear and the order would vanish from the
 * line. Removing the field removes the possibility.
 */
import { z } from 'zod';
import { TICKET_STATUS_VALUES, ORDER_TYPE_VALUES } from '../constants/enums.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParamSchema = z.object({ id: objectId }).strict();

/** Advance and recall take an empty body. `.strict()` rejects anything sent. */
export const emptyBodySchema = z.object({}).strict();

export const listTicketsSchema = z
  .object({
    status: z.enum(TICKET_STATUS_VALUES).optional(),
    type: z.enum(ORDER_TYPE_VALUES).optional(),
    /** Default false: a board showing every ticket ever served is unusable. */
    includeServed: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  })
  .strict();

export const boardSchema = z
  .object({
    type: z.enum(ORDER_TYPE_VALUES).optional(),
    /**
     * How far back the served column reaches, in minutes. Bounded because the
     * board is a live view, not a report — an unbounded window would drag the
     * whole day's history into a screen that refreshes constantly.
     */
    servedWithinMinutes: z.coerce.number().int().min(0).max(720).optional().default(60),
  })
  .strict();

export default { listTicketsSchema, boardSchema, emptyBodySchema, idParamSchema };
