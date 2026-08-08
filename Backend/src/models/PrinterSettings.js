/**
 * Receipt configuration — one document, for the whole restaurant.
 *
 * ── Why a fixed `_id` and not a `key` field ────────────────────────────────
 * A second settings document must be impossible, not merely discouraged. With
 * a constant primary key the database enforces that for free: a second insert
 * is a duplicate-key error on the index every collection already has. A `key`
 * field with a unique index would achieve the same thing while needing a
 * migration and an extra index to do it. `Counter.js` sets the precedent.
 *
 * ── Why every string defaults to '' ────────────────────────────────────────
 * The receipt header falls back to the `RESTAURANT` constant in config/pos.js
 * when a field is blank. That fallback is written as `settings.businessName ||
 * RESTAURANT.name`, which only behaves if an unset field is falsy — so an
 * admin who clears the box gets the built-in name back rather than a receipt
 * with no header at all.
 */
import mongoose from 'mongoose';

/** The only id this collection ever holds. */
export const PRINTER_SETTINGS_ID = 'printer';

/** Paper widths a thermal printer actually comes in. */
export const PAPER_WIDTHS = Object.freeze([58, 80]);

const printerSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: PRINTER_SETTINGS_ID },

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

    // Printed at the top of a customer bill. Never on a kitchen ticket — a
    // KOT that spends three lines on a GST number spends them every service.
    businessName: { type: String, trim: true, maxlength: 80, default: '' },
    businessAddress: { type: String, trim: true, maxlength: 200, default: '' },
    businessPhone: { type: String, trim: true, maxlength: 24, default: '' },
    gstNumber: { type: String, trim: true, maxlength: 20, default: '' },
    footerLine: { type: String, trim: true, maxlength: 120, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        // The client has no use for a primary key it can never vary.
        delete ret._id;
        return ret;
      },
    },
  },
);

/**
 * The settings, or the defaults when nothing has been saved yet.
 *
 * Never returns null. A fresh install must behave exactly like a configured
 * one, or every caller grows a second branch for "not set up yet" — and the
 * settings screen would have to handle a 404 that means "fine, use defaults".
 */
printerSettingsSchema.statics.load = async function load() {
  const found = await this.findById(PRINTER_SETTINGS_ID);
  if (found) return found;
  // Not persisted — a read must not write. The defaults come from the schema
  // itself so there is exactly one place they are declared.
  return new this({ _id: PRINTER_SETTINGS_ID });
};

export const PrinterSettings = mongoose.model('PrinterSettings', printerSettingsSchema);

/**
 * The same settings, memoised for a minute.
 *
 * The public invoice route is unauthenticated and rate-limited at 120/hour per
 * IP; a customer opening a receipt should not cost a settings query on top of
 * the order lookup. A minute is short enough that an admin saving a new
 * address sees it on the next receipt, and long enough that a burst of opens
 * is one read.
 *
 * Deliberately a plain module-scope memo rather than a cache library: it is
 * one document, and the invalidation is one call from one writer.
 */
let cached = null;
let cachedAt = 0;
const TTL_MS = 60_000;

export async function loadCachedSettings() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  cached = await PrinterSettings.load();
  cachedAt = Date.now();
  return cached;
}

/** Called by the settings writer, so a save is visible immediately. */
export function invalidateSettingsCache() {
  cached = null;
  cachedAt = 0;
}

export default PrinterSettings;
