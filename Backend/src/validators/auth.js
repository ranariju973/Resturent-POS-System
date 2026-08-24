/**
 * Auth request schemas.
 *
 * Every schema is `.strict()` — unknown keys are rejected, not stripped.
 * See the note at the bottom of src/middleware/validate.js.
 */
import { z } from 'zod';
import { PIN_LENGTH } from '../models/User.js';

/**
 * Google sign-in.
 *
 * The credential is the ID token Google Identity Services hands the page. Its
 * contents are not validated here beyond shape and a sane length ceiling —
 * everything that matters about it (signature, issuer, audience, expiry) is
 * checked cryptographically against Google's published keys in the controller,
 * and a schema that tried to pre-judge the payload would only be a second,
 * weaker opinion about it.
 *
 * The length bound is the same reasoning as the old password field's: an
 * unbounded string handed to a verifier is a CPU-exhaustion vector on an
 * unauthenticated endpoint. Real Google ID tokens run well under 2KB.
 */
export const googleLoginSchema = z
  .object({
    credential: z
      .string({ required_error: 'Google credential is required' })
      .min(1, 'Google credential is required')
      .max(4096, 'Google credential is too long'),
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

export default { googleLoginSchema, staffLoginSchema, logoutSchema };
