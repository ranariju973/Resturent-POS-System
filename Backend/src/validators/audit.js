/**
 * Audit-log query schema.
 *
 * The log is the record of who did what. Reading it is admin-only, and the
 * query is bounded like every other list endpoint — an audit trail is exactly
 * the collection someone would try to page through in bulk.
 */
import { z } from 'zod';
import { AUDIT_ACTION_VALUES } from '../constants/enums.js';

export const listAuditSchema = z
  .object({
    actor: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id').optional(),
    action: z.enum(AUDIT_ACTION_VALUES).optional(),
    resource: z.string().trim().max(40).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    skip: z.coerce.number().int().min(0).max(50_000).optional().default(0),
  })
  .strict()
  .refine((b) => !(b.from && b.to) || b.from <= b.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export default { listAuditSchema };
