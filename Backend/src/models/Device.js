/**
 * A terminal, bound to one restaurant.
 *
 * ── The problem this solves ────────────────────────────────────────────────
 * A cashier signs in by tapping four digits. There is no session yet, so the
 * server has no idea which restaurant those digits belong to — and once one
 * deployment serves many restaurants, "which restaurant" is the whole
 * question. Two venues can both issue PIN 1234, and matching it against the
 * wrong one is a cross-restaurant sign-in.
 *
 * So the terminal answers it. An owner links the machine once; from then on it
 * presents a long-lived token with every PIN attempt, and the PIN is only ever
 * matched within the restaurant that token resolves to.
 *
 * ── Why the device and not the person ──────────────────────────────────────
 * The alternatives were a restaurant code typed at the login screen, or a slug
 * in the URL. A typed code is a shared secret that every staff member enters
 * at the start of every shift — it is on a sticky note beside the till within
 * a week, and it adds friction to the most repeated gesture in a POS. A URL is
 * silently wrong when someone bookmarks the wrong one.
 *
 * The binding belongs to the machine bolted to the counter, which is the thing
 * that genuinely does not move between restaurants.
 *
 * ── What a stolen device token gets you ────────────────────────────────────
 * Very little, which is what justifies the long lifetime. It names a
 * restaurant; it grants no session. The PIN, its bcrypt verification and the
 * per-account lockout all still stand in front of any actual access. It is a
 * routing hint with a credential's storage discipline, not a credential.
 */
import mongoose from 'mongoose';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { tenantScoped } from './plugins/tenantScoped.js';

/** 256 bits. Long enough that guessing is not a strategy. */
const TOKEN_BYTES = 32;

const deviceSchema = new mongoose.Schema(
  {
    /** What the owner called it — 'Front counter', 'Terminal 2'. */
    name: {
      type: String,
      required: [true, 'Terminal name is required'],
      trim: true,
      minlength: 2,
      maxlength: 60,
    },

    /**
     * HMAC of the token, never the token.
     *
     * Globally unique, and deliberately so: it is looked up BEFORE any tenant
     * is known — the lookup is what discovers the tenant. Same role, and the
     * same justification, as Order.invoiceTokenHash. Unguessable input means
     * deployment-wide uniqueness costs nothing.
     *
     * HMAC rather than bcrypt because this must be FOUND by its hash, which
     * rules out a per-row salt. The pepper lives in the environment, so a
     * leaked database alone does not let an attacker compute one.
     */
    tokenHash: {
      type: String,
      required: true,
      select: false,
      index: { unique: true },
    },

    /** Updated on each successful staff login, so an unused terminal is visible. */
    lastSeenAt: { type: Date, default: null },

    /**
     * Unlinking a terminal is a deactivation, not a delete: the audit trail
     * refers to it, and a machine that was decommissioned is a fact worth
     * keeping rather than a row worth losing.
     */
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.tokenHash;
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

deviceSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/*
 * Terminal names are unique per restaurant among live devices — two "Front
 * counter" terminals in one venue is a mistake worth refusing, and the same
 * name in two restaurants is unremarkable.
 */
deviceSchema.plugin(tenantScoped, {
  unique: [
    {
      fields: { name: 1 },
      options: {
        partialFilterExpression: { isActive: true },
        collation: { locale: 'en', strength: 2 },
      },
    },
  ],
});

/** A fresh token. Returned once, to be set as a cookie and never stored raw. */
export const mintDeviceToken = () => randomBytes(TOKEN_BYTES).toString('base64url');

/** The stored form of a token. */
export const hashDeviceToken = (token) =>
  createHmac('sha256', env.DEVICE_TOKEN_PEPPER).update(String(token)).digest('hex');

/**
 * Resolve a raw token to its device.
 *
 * MUST be called inside runUnscoped: the tenant is precisely what this is
 * trying to discover, so there is no tenant to scope the query by.
 *
 * @param {string} token
 * @returns {Promise<mongoose.Document|null>}
 */
deviceSchema.statics.findByToken = function findByToken(token) {
  if (typeof token !== 'string' || token === '') return Promise.resolve(null);
  return this.findOne({ tokenHash: hashDeviceToken(token), isActive: true })
    .select('+tokenHash');
};

/**
 * Constant-time check that a token matches this device.
 *
 * The indexed lookup above already proves it, so this is belt and braces for
 * any caller that holds a device and a token from different sources.
 */
deviceSchema.methods.verifyToken = function verifyToken(token) {
  if (!this.tokenHash) return false;
  const expected = Buffer.from(this.tokenHash, 'hex');
  const given = Buffer.from(hashDeviceToken(token), 'hex');
  // timingSafeEqual throws on a length mismatch, and the throw is itself a
  // signal — compare lengths first.
  return expected.length === given.length && timingSafeEqual(expected, given);
};

export const Device = mongoose.model('Device', deviceSchema);
export default Device;
