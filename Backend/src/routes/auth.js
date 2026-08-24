/**
 * Auth routes.
 *
 * The login routes and refresh are the only unauthenticated write endpoints in
 * the system, so each carries its own rate limiter, stricter than the general
 * API limiter mounted above them.
 *
 * Note what is NOT here: any way to sign in with a password. Administrators
 * authenticate with Google (POST /google) and staff with a 4-digit PIN at a
 * linked terminal (POST /login/staff). There is no third door.
 */
import { Router } from 'express';
import { loginLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { googleLoginSchema, staffLoginSchema, logoutSchema } from '../validators/auth.js';
import { loginGoogle, loginStaff, refresh, logout, me } from '../controllers/authController.js';

const router = Router();

/** Owners and administrators — a Google ID token. */
router.post('/google', loginLimiter, validate({ body: googleLoginSchema }), loginGoogle);

/**
 * Cashier / kitchen staff — 4-digit PIN.
 *
 * The restaurant comes from the terminal's device cookie, not the body: PINs
 * are unique per restaurant, so a lookup without one would be ambiguous.
 */
router.post('/login/staff', loginLimiter, validate({ body: staffLoginSchema }), loginStaff);

/** Rotate the refresh cookie for a fresh access token. */
router.post('/refresh', refreshLimiter, refresh);

/** Revoke the session. Deliberately unauthenticated: an expired access token
 *  must not prevent a client from logging out cleanly. */
router.post('/logout', validate({ body: logoutSchema }), logout);

/** Current user, from the database rather than the token's claims. */
router.get('/me', requireAuth(), me);

export default router;
