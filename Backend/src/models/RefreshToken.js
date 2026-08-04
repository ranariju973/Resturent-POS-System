/**
 * Refresh token record — the server-side half of session management.
 *
 * ── Why this exists beyond the brief ───────────────────────────────────────
 * The brief offered "store a hash of active refresh tokens OR a token-version
 * field". This does both, because they solve different problems:
 *
 *   tokenVersion (on User)  revoke EVERYTHING for a user at once — password
 *                           change, role change, forced sign-out.
 *   RefreshToken (here)     revoke ONE session, and detect token theft.
 *
 * ── Rotation with reuse detection ──────────────────────────────────────────
 * Every refresh issues a new token and immediately revokes the old one. A
 * refresh token is therefore single-use. If a revoked token is ever presented
 * again, exactly one of two things happened: an attacker stole it and is
 * replaying, or the legitimate client is replaying after the attacker already
 * rotated. Both mean the session is compromised, and there is no way to tell
 * which party is which — so the entire family is revoked and both are forced
 * to log in again. That is the intended behaviour, not collateral damage.
 *
 * `family` links every token descended from one login, which is what makes
 * that blast radius exactly one session rather than one token.
 *
 * ── Storage ────────────────────────────────────────────────────────────────
 * Only a SHA-256 hash of the token is stored, never the token. A stolen
 * database dump then yields no usable sessions. SHA-256 rather than bcrypt is
 * correct here: the token is 256 bits of cryptographic randomness, not a
 * guessable human secret, so there is nothing for a slow hash to defend
 * against — and refresh is a hot path.
 */
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';

/** Hash a raw refresh token for storage/lookup. */
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

const refreshTokenSchema = new mongoose.Schema(
  {
    /** JWT id claim — the lookup key, so a revoked token is found in one hit. */
    jti: { type: String, required: true, unique: true },

    tokenHash: { type: String, required: true, index: true },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** All tokens descended from a single login share this id. */
    family: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    expiresAt: { type: Date, required: true },

    revokedAt: { type: Date, default: null },

    /** Why it was revoked — 'rotated', 'logout', 'reuse-detected', 'user-revoked'. */
    revokedReason: { type: String, default: null },

    /** The jti this token was rotated into. Traces a session's chain. */
    replacedBy: { type: String, default: null },

    // Captured at issue time so a suspicious refresh can be investigated.
    ip: { type: String, trim: true, maxlength: 64, default: '' },
    userAgent: { type: String, trim: true, maxlength: 300, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// MongoDB deletes expired documents automatically — no cleanup job to forget
// to schedule, and the collection cannot grow without bound.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

refreshTokenSchema.index({ family: 1, revokedAt: 1 });

/** Usable = not revoked and not past expiry. */
refreshTokenSchema.methods.isActive = function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
};

/**
 * Record a newly issued token.
 * @param {{jti: string, token: string, userId: any, family: any, expiresAt: Date, ip?: string, userAgent?: string}} args
 */
refreshTokenSchema.statics.issue = function issue({
  jti,
  token,
  userId,
  family,
  expiresAt,
  ip = '',
  userAgent = '',
}) {
  return this.create({
    jti,
    tokenHash: hashToken(token),
    user: userId,
    family,
    expiresAt,
    ip,
    userAgent: String(userAgent).slice(0, 300),
  });
};

/**
 * Revoke every live token in a family. Called on logout and, critically, when
 * a already-rotated token is replayed.
 * @param {any} family
 * @param {string} reason
 */
refreshTokenSchema.statics.revokeFamily = function revokeFamily(family, reason) {
  return this.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
};

/** Revoke every live token for a user, across all their sessions. */
refreshTokenSchema.statics.revokeAllForUser = function revokeAllForUser(userId, reason) {
  return this.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
};

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;
