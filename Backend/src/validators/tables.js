/**
 * Table request schemas.
 *
 * The seat count is the field worth being strict about. It is admin-supplied
 * and drives UI that renders a chair per seat, so an unbounded value is a
 * cheap way to make the floor plan unusable. Bounds match the model's.
 *
 * Every schema is `.strict()`.
 */
import { z } from 'zod';
import { TABLE_STATUS_VALUES } from '../constants/enums.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const idParamSchema = z.object({ id: objectId }).strict();

/**
 * Table name — 'T1', 'P4'. Uppercased by the model.
 * Restricted to letters, digits and a dash so a name cannot carry markup or
 * whitespace that would render oddly on the floor plan.
 */
const tableName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(12, 'Name is too long')
  .regex(/^[A-Za-z0-9-]+$/, 'Name may contain only letters, numbers and dashes');

const seats = z.coerce
  .number()
  .int('Seat count must be a whole number')
  .min(1, 'A table needs at least one seat')
  .max(50, 'Seat count must be 50 or fewer');

const zone = z
  .string()
  .trim()
  .min(1, 'Zone is required')
  .max(30, 'Zone name is too long')
  // Free text so an admin can invent zones, but no markup.
  .regex(/^[A-Za-z0-9 &'-]+$/, 'Zone may contain only letters, numbers, spaces and & \' -');

export const createTableSchema = z
  .object({ name: tableName, seats, zone })
  .strict();

export const updateTableSchema = z
  .object({
    name: tableName.optional(),
    seats: seats.optional(),
    zone: zone.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export const listTablesSchema = z
  .object({
    zone: zone.optional(),
    status: z.enum(TABLE_STATUS_VALUES).optional(),
    includeInactive: z.enum(['true', 'false']).optional(),
  })
  .strict();

/**
 * Seating a party.
 *
 * `partySize` is optional and advisory — it is recorded, not enforced against
 * the seat count. Refusing to seat five people at a four-top would be the
 * software overruling the person standing in the room, who can see that they
 * pulled up a chair.
 */
export const seatSchema = z
  .object({
    partySize: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

/** Reserving. Same advisory treatment of party size. */
export const reserveSchema = z
  .object({
    partySize: z.coerce.number().int().min(1).max(50).optional(),
    note: z.string().trim().max(120).optional(),
  })
  .strict();

/** Move an open bill to another table. */
export const transferSchema = z.object({ targetTableId: objectId }).strict();

/** Fold this table into another. The target keeps the bill. */
export const mergeSchema = z.object({ targetTableId: objectId }).strict();

/**
 * Split-bill preview.
 *
 * `ways` is capped at the maximum seat count — splitting a bill 500 ways is
 * not a real request, and the response array is sized by this number.
 */
export const splitSchema = z
  .object({
    ways: z.coerce
      .number()
      .int('Split count must be a whole number')
      .min(2, 'A split needs at least 2 ways')
      .max(50, 'Split count must be 50 or fewer'),
  })
  .strict();

export default {
  createTableSchema,
  updateTableSchema,
  listTablesSchema,
  seatSchema,
  reserveSchema,
  transferSchema,
  mergeSchema,
  splitSchema,
  idParamSchema,
};
