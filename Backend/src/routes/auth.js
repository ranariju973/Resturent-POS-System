/**
 * Auth routes.
 *
 * The two login routes and refresh are the only unauthenticated write
 * endpoints in the system, so each carries its own rate limiter. Phase 4 adds
 * the general API limiter above these; these stay stricter.
 */
import { Router } from 'express';
import { loginLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { adminLoginSchema, staffLoginSchema, logoutSchema } from '../validators/auth.js';
import { loginAdmin, loginStaff, refresh, logout, me } from '../controllers/authController.js';

const router = Router();

/** Admin — email + password. */
router.post('/login/admin', loginLimiter, validate({ body: adminLoginSchema }), loginAdmin);

/** Cashier / kitchen staff — 4-digit PIN. */
router.post('/login/staff', loginLimiter, validate({ body: staffLoginSchema }), loginStaff);

/** Rotate the refresh cookie for a fresh access token. */
router.post('/refresh', refreshLimiter, refresh);

/** Revoke the session. Deliberately unauthenticated: an expired access token
 *  must not prevent a client from logging out cleanly. */
router.post('/logout', validate({ body: logoutSchema }), logout);

/** Current user, from the database rather than the token's claims. */
router.get('/me', requireAuth(), me);

export default router;
