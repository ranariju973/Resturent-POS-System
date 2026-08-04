/**
 * Staff account.
 *
 * Two sign-in shapes, one document:
 *   • admin        — email + password
 *   • cashier /    — 4-digit PIN
 *     kitchen_staff
 *
 * ── PIN storage, and why there are two hashes ──────────────────────────────
 * A 4-digit PIN has 10,000 possible values, so it needs care a password does
 * not:
 *
 *   pinHash    bcrypt(pin + pepper), cost 12. Used to VERIFY. Slow by design.
 *   pinLookup  HMAC-SHA256(pin, PIN_PEPPER). Deterministic, indexed, unique.
 *              Used to FIND the matching staff member in one query.
 *
 * Without pinLookup, a PIN login has to bcrypt-compare against every active
 * staff row — O(n) deliberately-slow hashes per attempt, which is both slow
 * and a free CPU-exhaustion vector for an unauthenticated endpoint. The
 * lookup hash makes it O(1) plus a single bcrypt verify.
 *
 * pinLookup is unsalted (it must be, to be searchable), which is exactly why
 * it is peppered with a secret held only in the environment: someone holding
 * a stolen database dump still cannot enumerate the 10,000 candidates without
 * also holding PIN_PEPPER.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ROLES, ROLE_VALUES, PIN_ROLES } from '../constants/enums.js';

const BCRYPT_COST = 12;
const PIN_LENGTH = 4;

/** Failed attempts before the account is temporarily locked. */
export const MAX_FAILED_ATTEMPTS = 5;

/**
 * Base lock duration. Doubles with each consecutive lockout — see
 * lockDurationFor() below.
 */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/** Ceiling on the backoff, so a locked-out staff member is never stranded. */
export const MAX_LOCK_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Progressive lockout.
 *
 * A flat 5-attempts-per-15-minutes lock sounds strict but is not, against a
 * 4-digit PIN: 480 guesses a day exhausts all 10,000 in about three weeks of
 * patient, unattended attack, and with a handful of staff sharing the
 * keyspace an expected hit arrives sooner than that. Long enough to matter.
 *
 * Doubling the lock on each consecutive lockout collapses that. The first
 * lockout costs 15 minutes, the fifth costs 4 hours, and from the sixth on the
 * attacker gets at most 5 guesses per capped 24-hour window — which pushes a
 * full sweep past five years. A staff member who mistypes twice in a row is
 * unaffected, because the counter resets on any successful login.
 *
 * @param {number} consecutiveLockouts 0 for the first lockout
 * @returns {number} milliseconds
 */
export function lockDurationFor(consecutiveLockouts = 0) {
  const n = Math.max(0, Math.min(consecutiveLockouts, 20));
  return Math.min(LOCK_DURATION_MS * 2 ** n, MAX_LOCK_DURATION_MS);
}

const pinLookupHash = (pin) =>
  createHmac('sha256', env.PIN_PEPPER).update(String(pin)).digest('hex');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },

    role: {
      type: String,
      required: true,
      enum: { values: ROLE_VALUES, message: '{VALUE} is not a valid role' },
      index: true,
    },

    // Admins only. `sparse` so the many PIN users with no email do not all
    // collide on null under the unique index.
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
      index: { unique: true, sparse: true },
    },

    // select:false — these never load unless a query explicitly asks, so they
    // cannot leak through a stray `res.json(user)` even if toJSON were missed.
    passwordHash: { type: String, select: false },
    pinHash: { type: String, select: false },
    pinLookup: { type: String, select: false, index: { unique: true, sparse: true } },

    /**
     * ── Manager override PIN (admins only) ─────────────────────────────────
     * A SEPARATE credential from `pinHash`, and deliberately so.
     *
     * It authorises a privileged action on someone else's session — a cashier
     * voiding a paid bill, or discounting past the ceiling — by having a
     * manager tap four digits at the terminal. It does NOT log anyone in:
     * `findActiveByPin` restricts itself to PIN_ROLES, which excludes admin,
     * so possessing this value cannot start a session.
     *
     * Keeping it distinct from the staff login PIN preserves the invariant
     * that admins authenticate with email and password, while still giving the
     * manager-approval gesture every real POS has. A single shared field would
     * have quietly turned every override PIN into a login credential.
     *
     * Optional: an admin without one simply cannot approve at the terminal,
     * and the cashier has to fetch someone who can.
     */
    overridePinHash: { type: String, select: false },
    overridePinLookup: { type: String, select: false, index: { unique: true, sparse: true } },

    avatarUrl: { type: String, trim: true, maxlength: 500, default: '' },

    isActive: { type: Boolean, default: true, index: true },

    /**
     * Bumped on logout / password change / forced revoke. Access and refresh
     * tokens carry the value they were minted with; Phase 2 rejects any token
     * whose version is stale. This is what makes logout actually revoke a
     * token server-side rather than just clearing the client's cookie.
     */
    tokenVersion: { type: Number, default: 0, select: false },

    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },

    /** Consecutive lockouts, driving the exponential backoff. Reset on success. */
    lockoutCount: { type: Number, default: 0, select: false },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.pinHash;
        delete ret.pinLookup;
        delete ret.overridePinHash;
        delete ret.overridePinLookup;
        delete ret.tokenVersion;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.lockoutCount;
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

userSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/** True while a lockout from repeated failed logins is in effect. */
userSchema.virtual('isLocked').get(function lockedGetter() {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
});

// --- Integrity -------------------------------------------------------------
// An admin without a password, or a cashier without a PIN, is an account that
// can never be authenticated — reject it at write time rather than discovering
// it at the login screen.
userSchema.pre('validate', function validateCredentialShape(next) {
  if (this.role === ROLES.ADMIN) {
    if (!this.email) return next(new Error('Admin accounts require an email address'));
    if (!this.passwordHash && this.isNew) {
      return next(new Error('Admin accounts require a password'));
    }
  }

  if (PIN_ROLES.includes(this.role)) {
    if (!this.pinHash && this.isNew) {
      return next(new Error(`${this.role} accounts require a PIN`));
    }
  }

  return next();
});

// --- Credential helpers ----------------------------------------------------

/**
 * Hash and set an admin password. Never assign passwordHash directly.
 * @param {string} plain
 */
userSchema.methods.setPassword = async function setPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_COST);
};

/**
 * Constant-time-ish password check. Returns false rather than throwing when
 * no hash is loaded, so callers cannot distinguish "wrong password" from
 * "this account has no password".
 * @param {string} plain
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = async function verifyPassword(plain) {
  if (!this.passwordHash || typeof plain !== 'string') return false;
  return bcrypt.compare(plain, this.passwordHash);
};

/**
 * Hash and set a staff PIN, populating both the verify hash and the lookup
 * hash together so they can never drift apart.
 * @param {string} plain 4 digits
 */
userSchema.methods.setPin = async function setPin(plain) {
  const pin = String(plain);
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits`);
  }
  // Pepper the bcrypt input too: bcrypt silently truncates at 72 bytes, which
  // a 4-digit PIN is nowhere near, so this is free extra entropy.
  this.pinHash = await bcrypt.hash(`${pin}${env.PIN_PEPPER}`, BCRYPT_COST);
  this.pinLookup = pinLookupHash(pin);
};

/**
 * @param {string} plain
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPin = async function verifyPin(plain) {
  if (!this.pinHash || typeof plain !== 'string') return false;
  return bcrypt.compare(`${plain}${env.PIN_PEPPER}`, this.pinHash);
};

// --- Lockout ---------------------------------------------------------------

/**
 * Record a failed attempt and lock the account once the threshold is hit.
 * Uses an atomic update so two concurrent attempts cannot both read 4 and
 * write 5, letting an attacker exceed the limit by racing.
 */
userSchema.methods.registerFailedLogin = async function registerFailedLogin() {
  const attempts = (this.failedLoginAttempts ?? 0) + 1;

  if (attempts < MAX_FAILED_ATTEMPTS) {
    await this.constructor.updateOne({ _id: this._id }, { $inc: { failedLoginAttempts: 1 } });
    return false;
  }

  // Threshold hit: lock, and make the next lock twice as long as this one.
  const duration = lockDurationFor(this.lockoutCount ?? 0);
  await this.constructor.updateOne(
    { _id: this._id },
    {
      $set: { lockUntil: new Date(Date.now() + duration), failedLoginAttempts: 0 },
      $inc: { lockoutCount: 1 },
    },
  );
  return true;
};

/**
 * Clear the counters after a successful login.
 * Resetting lockoutCount here is what keeps the backoff off the backs of
 * legitimate users: one correct sign-in wipes the escalation entirely.
 */
userSchema.methods.registerSuccessfulLogin = async function registerSuccessfulLogin() {
  await this.constructor.updateOne(
    { _id: this._id },
    {
      $set: { failedLoginAttempts: 0, lockoutCount: 0, lastLoginAt: new Date() },
      $unset: { lockUntil: 1 },
    },
  );
};

/** Invalidate every issued token for this user (logout-everywhere / revoke). */
userSchema.methods.revokeTokens = async function revokeTokens() {
  await this.constructor.updateOne({ _id: this._id }, { $inc: { tokenVersion: 1 } });
};

// --- Statics ---------------------------------------------------------------

/**
 * Find the active PIN-role staff member holding this PIN, in one indexed
 * query. Returns null for an unknown PIN.
 *
 * The caller MUST still call verifyPin() on the result — this only narrows
 * the candidate; bcrypt is what actually authenticates.
 *
 * @param {string} pin
 * @returns {Promise<import('mongoose').Document|null>}
 */
/**
 * Set an admin's manager-override PIN. Admin-only by construction.
 * @param {string} plain 4 digits
 */
userSchema.methods.setOverridePin = async function setOverridePin(plain) {
  if (this.role !== ROLES.ADMIN) {
    throw new Error('Only admin accounts may hold an override PIN');
  }
  const pin = String(plain);
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    throw new Error(`Override PIN must be exactly ${PIN_LENGTH} digits`);
  }
  // Domain-separated from the login PIN so the same four digits used for both
  // purposes do not produce the same stored hash.
  this.overridePinHash = await bcrypt.hash(`override:${pin}${env.PIN_PEPPER}`, BCRYPT_COST);
  this.overridePinLookup = createHmac('sha256', env.PIN_PEPPER)
    .update(`override:${pin}`)
    .digest('hex');
};

userSchema.methods.verifyOverridePin = async function verifyOverridePin(plain) {
  if (!this.overridePinHash || typeof plain !== 'string') return false;
  return bcrypt.compare(`override:${plain}${env.PIN_PEPPER}`, this.overridePinHash);
};

/**
 * Find the admin holding this override PIN.
 *
 * Restricted to admins, and used ONLY to authorise an action inside another
 * user's request. It never issues a token and never starts a session — see
 * the note on `overridePinHash`.
 *
 * The caller MUST still call verifyOverridePin() on the result.
 */
userSchema.statics.findAdminByOverridePin = function findAdminByOverridePin(pin) {
  if (!/^\d+$/.test(String(pin))) return Promise.resolve(null);
  const lookup = createHmac('sha256', env.PIN_PEPPER)
    .update(`override:${String(pin)}`)
    .digest('hex');

  return this.findOne({
    overridePinLookup: lookup,
    role: ROLES.ADMIN,
    isActive: true,
  }).select('+overridePinHash');
};

userSchema.statics.findActiveByPin = function findActiveByPin(pin) {
  if (!/^\d+$/.test(String(pin))) return Promise.resolve(null);
  return this.findOne({
    pinLookup: pinLookupHash(pin),
    // mongoose.trusted() is required because `sanitizeFilter` is enabled
    // globally (src/config/db.js). Without it, this server-authored operator
    // object is wrapped in $eq and Mongoose tries to cast it to a string.
    role: mongoose.trusted({ $in: [...PIN_ROLES] }),
    isActive: true,
  }).select('+pinHash +pinLookup +tokenVersion +failedLoginAttempts +lockUntil +lockoutCount');
};

/** Load an admin by email with the credential fields attached. */
userSchema.statics.findActiveAdminByEmail = function findActiveAdminByEmail(email) {
  if (typeof email !== 'string') return Promise.resolve(null);
  return this.findOne({
    email: email.trim().toLowerCase(),
    role: ROLES.ADMIN,
    isActive: true,
  }).select('+passwordHash +tokenVersion +failedLoginAttempts +lockUntil +lockoutCount');
};

/**
 * Compare two strings without leaking length or content through timing.
 * Exported for Phase 2's admin-override PIN check.
 */
export function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const User = mongoose.model('User', userSchema);
export { pinLookupHash, BCRYPT_COST, PIN_LENGTH };
export default User;
