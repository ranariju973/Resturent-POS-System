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
 * ── Password bounds, shared by signup and sign-in ──────────────────────────
 *
 * The 72 is not a round number: bcrypt truncates its input at 72 BYTES and
 * silently ignores everything after. A longer password is therefore not a
 * stronger one, it only feels like it — and accepting it would mean two
 * different passphrases sharing a hash. Refusing it says so honestly.
 *
 * It is also the same CPU-exhaustion guard the Google credential's max(4096)
 * embodies: this is an unauthenticated endpoint handing a string to a
 * deliberately slow hash function.
 */
const PASSWORD_MAX = 72;

/** Floor for a NEW password. Not applied at sign-in — see passwordLoginSchema. */
const PASSWORD_MIN = 10;

const emailField = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

/**
 * Owner signup — the second administrator door, alongside Google.
 *
 * Creates an account with no restaurant, exactly as a first-time Google
 * sign-in does; naming the restaurant is the next step either way.
 */
export const registerSchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required' })
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(80, 'Name cannot exceed 80 characters'),
    email: emailField,
    password: z
      .string({ required_error: 'Password is required' })
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
      .max(PASSWORD_MAX, `Password cannot exceed ${PASSWORD_MAX} characters`),
  })
  .strict();

/**
 * Owner sign-in.
 *
 * Deliberately does NOT apply PASSWORD_MIN. A login form is not the place to
 * publish the policy — rejecting a 9-character attempt before checking it
 * tells an attacker the floor for free, and it would strand any account whose
 * password predates a future change to that floor. Only the bcrypt ceiling is
 * enforced, because that one is about what the hash can physically read.
 */
export const passwordLoginSchema = z
  .object({
    email: emailField,
    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password is required')
      .max(PASSWORD_MAX, 'Password cannot exceed 72 characters'),
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

export default {
  googleLoginSchema,
  staffLoginSchema,
  registerSchema,
  passwordLoginSchema,
  logoutSchema,
};
