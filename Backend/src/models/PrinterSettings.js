/**
 * Receipt hardware configuration — one document per restaurant.
 *
 * ── What moved out of here ─────────────────────────────────────────────────
 * This used to hold the business identity too — name, address, phone, GST
 * number, footer — with a `RESTAURANT` constant in config/pos.js as the
 * fallback. Two places described one fact, and the receipt renderer had to
 * pick between them.
 *
 * Identity now lives on the Tenant document, which is where a restaurant's
 * name belongs once there is more than one restaurant. What stays here is
 * strictly HARDWARE: paper width, copy counts, and which named printer gets
 * which document. Those vary per venue and have nothing to do with who the
 * business is.
 *
 * ── Why the fixed `_id` had to go ──────────────────────────────────────────
 * A constant primary key made a second settings document impossible, which
 * was exactly right when there was one restaurant. With many, "impossible"
 * becomes "only the first restaurant may have settings". The guarantee is
 * preserved in the form it should now take — one document per TENANT — by a
 * unique index on `tenantId`, which the tenantScoped plugin declares. A second
 * insert for the same restaurant is still a duplicate-key error; the database
 * still enforces it; only the scope changed.
 */
import mongoose from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped.js';
import { getTenantId } from '../utils/tenantContext.js';
import { key, remember, del } from '../utils/cache.js';

/** Paper widths a thermal printer actually comes in. */
export const PAPER_WIDTHS = Object.freeze([58, 80]);

const printerSettingsSchema = new mongoose.Schema(
  {
    /** Millimetres. Decides the column budget: 58mm = 32 chars, 80mm = 48. */
    paperWidth: { type: Number, enum: PAPER_WIDTHS, default: 80 },

    billCopies: { type: Number, min: 1, max: 5, default: 1 },
    kotCopies: { type: Number, min: 1, max: 5, default: 1 },

    /**
     * Named printers. Only meaningful under QZ Tray — a browser cannot choose
     * a printer on the user's behalf, and these are ignored on that path.
     */
    kotPrinterName: { type: String, trim: true, maxlength: 120, default: '' },
    billPrinterName: { type: String, trim: true, maxlength: 120, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        // The client configures its own printers; the row's identity is not
        // something it can vary.
        delete ret._id;
        return ret;
      },
    },
  },
);

/**
 * One settings document per restaurant, enforced by the database rather than
 * by a check-then-write that two concurrent saves could interleave through.
 */
printerSettingsSchema.plugin(tenantScoped, {
  unique: [{ fields: {} }],
});

/**
 * This restaurant's settings, or the defaults when nothing has been saved.
 *
 * Never returns null. A fresh restaurant must behave exactly like a configured
 * one, or every caller grows a second branch for "not set up yet" — and the
 * settings screen would have to handle a 404 that means "fine, use defaults".
 */
printerSettingsSchema.statics.load = async function load() {
  const found = await this.findOne({});
  if (found) return found;

  /*
   * Not persisted — a read must not write. The defaults come from the schema
   * itself so there is exactly one place they are declared.
   *
   * tenantId is set explicitly because this document is never saved, so the
   * plugin's pre-validate hook (which would otherwise stamp it) never runs.
   * Without it the caller gets an object whose tenant is undefined.
   */
  return new this({ tenantId: getTenantId() });
};

export const PrinterSettings = mongoose.model('PrinterSettings', printerSettingsSchema);

/** How long a settings read is reused. See loadCachedSettings. */
const SETTINGS_TTL_MS = 60_000;

/** The cache key for the CURRENT restaurant. */
const settingsKey = () => key('settings', 'printer');

/**
 * This restaurant's settings, memoised for a minute.
 *
 * The public invoice route is unauthenticated and rate-limited at 120/hour per
 * IP; a customer opening a receipt should not cost a settings query on top of
 * the order lookup. A minute is short enough that an admin saving a new
 * printer configuration sees it on the next receipt, and long enough that a
 * burst of opens is one read.
 *
 * ── Why this is no longer a module-scope variable ──────────────────────────
 * It used to be `let cached` — one slot for the whole process. With one
 * restaurant that was simply a memo. With many it is a cross-tenant leak of
 * the worst kind: whichever restaurant's receipt was rendered first would
 * populate the slot, and every other restaurant's receipts would print that
 * one's configuration for the next minute. Going through `key()` partitions
 * the entry by the tenant in context, so each restaurant memoises its own.
 */
export async function loadCachedSettings() {
  return remember(settingsKey(), SETTINGS_TTL_MS, () => PrinterSettings.load());
}

/** Called by the settings writer, so a save is visible immediately. */
export async function invalidateSettingsCache() {
  await del(settingsKey());
}

export default PrinterSettings;
