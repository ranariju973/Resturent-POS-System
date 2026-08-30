/**
 * Authentication routes.
 *
 * ── Three doors, and what each one is for ──────────────────────────────────
 *   POST /google          owners and administrators — a Google ID token
 *   POST /register        owners and administrators — email + password, signup
 *   POST /login/password  the same account, returning
 *   POST /login/staff     cashiers and kitchen staff — a 4-digit PIN, at a
 *                         terminal that already knows its restaurant
 *
 * The two administrator doors are alternatives, not tiers: they issue the same
 * session, land on the same onboarding step and share one lockout policy. An
 * account may hold both credentials at once — signing in with Google on an
 * address that already has a password links them (see authController).
 *
 * Every unauthenticated route here is rate-limited and validated, and every
 * failure returns one indistinguishable message. Adding a fourth door means
 * adding an entry to tests/route-coverage.test.mjs saying why, which is the
 * point of that sweep.
 */
import { Router } from 'express';
import { loginLimiter, signupLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  googleLoginSchema,
  registerSchema,
  passwordLoginSchema,
  staffLoginSchema,
  logoutSchema,
} from '../validators/auth.js';
import {
  loginGoogle,
  registerWithPassword,
  loginPassword,
  loginStaff,
  refresh,
  logout,
  me,
} from '../controllers/authController.js';

const router = Router();

/** Owners and administrators — a Google ID token. */
router.post('/google', loginLimiter, validate({ body: googleLoginSchema }), loginGoogle);

/*
 * Owner signup. signupLimiter rather than loginLimiter, because a SUCCESS is
 * what needs bounding here — see the note on that limiter.
 */
router.post('/register', signupLimiter, validate({ body: registerSchema }), registerWithPassword);

/** Owners and administrators — email + password. */
router.post(
  '/login/password',
  loginLimiter,
  validate({ body: passwordLoginSchema }),
  loginPassword,
);

router.post('/login/staff', loginLimiter, validate({ body: staffLoginSchema }), loginStaff);
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', validate({ body: logoutSchema }), logout);
router.get('/me', requireAuth(), me);

export default router;
