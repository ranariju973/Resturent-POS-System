/**
 * Auth request schemas.
 *
 * Every schema is `.strict()` — unknown keys are rejected, not stripped.
 * See the note at the bottom of src/middleware/validate.js.
 */
import { z } from 'zod';
import { PIN_LENGTH } from '../models/User.js';

/**
 * Admin login.
 *
 * The password has a maximum length, which looks odd until you consider that
 * bcrypt's cost is proportional to input size — an unbounded password field is
 * a CPU-exhaustion vector on an unauthenticated endpoint. 72 bytes is also
 * where bcrypt truncates, so nothing above it adds entropy anyway.
 */
export const adminLoginSchema = z
  .object({
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .min(3, 'Email is required')
      .max(254, 'Email is too long')
      .email('Invalid email address'),

    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password is required')
      .max(72, 'Password is too long'),
  })
  .strict();

/** Staff PIN login. Exactly N digits, nothing else. */
export const staffLoginSchema = z
  .object({
    pin: z
      .string({ required_error: 'PIN is required' })
      .trim()
      .regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `PIN must be exactly ${PIN_LENGTH} digits`),
  })
  .strict();

/**
 * Logout body. `allDevices` ends every session for the user rather than just
 * the current one.
 */
export const logoutSchema = z
  .object({
    allDevices: z.boolean().optional().default(false),
  })
  .strict();

export default { adminLoginSchema, staffLoginSchema, logoutSchema };
