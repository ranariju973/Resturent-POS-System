/**
 * Attendance request schemas.
 *
 * The interesting one is `markDaySchema`: attendance is entered a whole day at
 * a time, for the whole roster, so the write endpoint takes a batch rather than
 * a single record. That shape is what lets the controller do one idempotent
 * bulkWrite instead of a loop of upserts, and it matches how the admin actually
 * works — they sit down once in the morning, not twenty times.
 */
import { z } from 'zod';
import { ATTENDANCE_STATUS_VALUES } from '../constants/enums.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParamSchema = z.object({ id: objectId }).strict();

/** YYYY-MM-DD, and a real date — '2026-02-31' parses but is not a day. */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

/** YYYY-MM. */
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

const status = z.enum(ATTENDANCE_STATUS_VALUES, {
  errorMap: () => ({ message: 'Invalid attendance status' }),
});

const notes = z.string().trim().max(200, 'Notes are too long');

/**
 * The month view. `employee` narrows it to one person's record; without it the
 * response covers the whole roster, which is what the Attendance tab renders.
 */
export const attendanceMonthSchema = z
  .object({
    month: isoMonth,
    employee: objectId.optional(),
  })
  .strict();

export const attendanceDaySchema = z.object({ date: isoDay }).strict();

/**
 * Mark a whole day.
 *
 * Capped at 100 entries: a restaurant roster is tens of people, and an
 * unbounded array here would let one request drive an arbitrarily large
 * bulkWrite. The controller additionally verifies every id belongs to a real
 * PIN-role employee before writing anything — without that check an admin
 * could mint attendance rows against arbitrary ObjectIds.
 */
export const markDaySchema = z
  .object({
    date: isoDay,
    entries: z
      .array(
        z
          .object({
            employee: objectId,
            status,
            notes: notes.optional().default(''),
          })
          .strict(),
      )
      .min(1, 'Nothing to mark')
      .max(100, 'Too many entries in one request'),
  })
  .strict();

export const updateAttendanceSchema = z
  .object({
    status: status.optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export default {
  attendanceMonthSchema,
  attendanceDaySchema,
  markDaySchema,
  updateAttendanceSchema,
  idParamSchema,
};
