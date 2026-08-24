/**
 * A restaurant.
 *
 * One deployment serves many, and this document is what every other record in
 * the database belongs to. It is the only model that is NOT tenant-scoped —
 * it cannot be scoped by itself.
 *
 * ── What lives here, and what does not ─────────────────────────────────────
 * This holds IDENTITY: the name on the receipt, the address, the tax number.
 * Printer mechanics — paper width, copy counts, which named printer gets the
 * kitchen ticket — stay on PrinterSettings, because they describe hardware
 * that varies per venue rather than the business itself.
 *
 * That split resolves a real ambiguity. `businessName` previously existed on
 * PrinterSettings while a `RESTAURANT` constant in config/pos.js held the
 * fallback, so two places described one fact and the receipt renderer had to
 * pick between them. There is now one answer, and it is this document.
 *
 * The constant it replaced said as much:
 *   "Promote it to the database the day a second location exists."
 */
import mongoose from 'mongoose';

/** URL-safe, lowercase, no leading/trailing dashes. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Restaurant name is required'],
      trim: true,
      minlength: [2, 'Restaurant name must be at least 2 characters'],
      maxlength: [80, 'Restaurant name cannot exceed 80 characters'],
    },

    /**
     * A stable, human-readable handle — globally unique.
     *
     * Global rather than per-tenant for the obvious reason: it identifies the
     * tenant, so scoping it to a tenant would be circular. It exists so a
     * restaurant can later be addressed by something other than a 24-character
     * ObjectId (a subdomain, a terminal setup link) without that identifier
     * having to change.
     *
     * Derived from the name at creation and never auto-updated afterwards:
     * renaming a business must not silently break a URL somebody bookmarked.
     */
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 50,
      match: [SLUG_PATTERN, 'Slug may contain only lowercase letters, numbers and dashes'],
      index: { unique: true },
    },

    /**
     * The account that created the restaurant and cannot be removed from it.
     *
     * Nullable only for the instant between minting the tenant and saving the
     * owner inside the same transaction — a chicken-and-egg the onboarding
     * flow resolves by creating both together.
     */
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // --- receipt identity ---------------------------------------------------
    /*
     * Every string defaults to '' rather than being absent, so the receipt
     * renderer's `tenant.address || ''` style fallbacks behave predictably and
     * an admin clearing a box gets a blank line, not the string "undefined".
     */
    tagline: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'Thank you for dining with us',
    },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    phone: { type: String, trim: true, maxlength: 24, default: '' },
    gstNumber: { type: String, trim: true, maxlength: 20, default: '' },
    footerLine: { type: String, trim: true, maxlength: 120, default: '' },

    /**
     * Deactivating a restaurant stops its people signing in without deleting
     * a byte of its history — the orders still have to be reportable, and a
     * paid invoice link a customer holds should not 404 because a subscription
     * lapsed.
     */
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

tenantSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/**
 * Turn a restaurant name into a slug candidate.
 *
 * Strips accents first so "Café Böhm" becomes "cafe-bohm" rather than losing
 * both words to the non-ASCII filter and collapsing to an empty string.
 *
 * @param {string} name
 * @returns {string} Possibly empty, when the name is entirely non-Latin.
 */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * A slug that is free, derived from the name.
 *
 * Appends a short random suffix on collision rather than a counter: a counter
 * requires reading the highest existing value, which is a race, and it also
 * tells the world how many restaurants share a name.
 *
 * The unique index remains the real guarantee — this is a courtesy that makes
 * the common case produce a readable slug. Two simultaneous signups of the
 * same name can still collide here, and the second one's insert fails, which
 * the caller retries.
 *
 * @param {string} name
 * @param {object} [options]
 * @param {import('mongoose').ClientSession} [options.session]
 * @returns {Promise<string>}
 */
tenantSchema.statics.generateSlug = async function generateSlug(name, { session } = {}) {
  const base = slugify(name) || 'restaurant';
  // Minimum length is 3; a two-character name would otherwise fail validation.
  const seed = base.length >= 3 ? base : `${base}-pos`;

  if (!(await this.exists({ slug: seed }).session(session ?? null))) return seed;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${seed.slice(0, 40)}-${suffix}`;
    if (!(await this.exists({ slug: candidate }).session(session ?? null))) return candidate;
  }

  // Five collisions on a 36^4 space means something is wrong with the RNG, not
  // that we were unlucky. Fall back to something that cannot collide.
  return `${seed.slice(0, 30)}-${new mongoose.Types.ObjectId().toHexString().slice(-8)}`;
};

export const Tenant = mongoose.model('Tenant', tenantSchema);
export default Tenant;
