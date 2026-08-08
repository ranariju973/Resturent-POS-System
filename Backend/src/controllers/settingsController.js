/**
 * Printer and receipt settings. Admin only — `settings:manage`.
 *
 * One document for the whole restaurant (see models/PrinterSettings.js), so
 * there is no id to address and no list to page through: a GET and a PUT.
 */
import {
  PrinterSettings,
  PRINTER_SETTINGS_ID,
  invalidateSettingsCache,
} from '../models/PrinterSettings.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { RESTAURANT } from '../config/pos.js';
import { sendSuccess, asyncHandler } from '../utils/apiResponse.js';

/**
 * The shape the client works with.
 *
 * `effective*` fields resolve the fallback chain here rather than in the UI,
 * so the settings screen, the thermal bill and the public web invoice cannot
 * disagree about what the restaurant is called.
 */
export const publicPrinterSettings = (doc) => ({
  paperWidth: doc.paperWidth,
  billCopies: doc.billCopies,
  kotCopies: doc.kotCopies,
  kotPrinterName: doc.kotPrinterName ?? '',
  billPrinterName: doc.billPrinterName ?? '',
  businessName: doc.businessName ?? '',
  businessAddress: doc.businessAddress ?? '',
  businessPhone: doc.businessPhone ?? '',
  gstNumber: doc.gstNumber ?? '',
  footerLine: doc.footerLine ?? '',
  // What a receipt will actually print, once the built-in defaults are applied.
  effectiveName: doc.businessName || RESTAURANT.name,
  effectiveFooter: doc.footerLine || RESTAURANT.tagline,
});

// ---------------------------------------------------------------------------
// GET /api/settings/printer
// ---------------------------------------------------------------------------
/**
 * Never 404s. An unconfigured restaurant gets the schema defaults, so a fresh
 * install and a configured one look identical to every caller — the settings
 * screen has one code path rather than a "not set up yet" branch.
 */
export const getPrinterSettings = asyncHandler(async (req, res) => {
  const settings = await PrinterSettings.load();
  return sendSuccess(res, { settings: publicPrinterSettings(settings) });
});

// ---------------------------------------------------------------------------
// PUT /api/settings/printer
// ---------------------------------------------------------------------------
/**
 * Upsert. The fixed `_id` makes a second document impossible, so this is a
 * write that cannot accidentally fork the configuration.
 *
 * Only the submitted keys are applied — the validator marks every field
 * optional, so a form that omits one leaves the stored value alone rather than
 * clearing it.
 */
export const updatePrinterSettings = asyncHandler(async (req, res) => {
  const settings = await PrinterSettings.findByIdAndUpdate(
    PRINTER_SETTINGS_ID,
    { $set: req.body },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );

  // Drop the memo the public invoice route reads through, or a saved address
  // stays invisible on receipts for up to a minute.
  invalidateSettingsCache();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.SETTINGS_UPDATE,
      resource: 'PrinterSettings',
      resourceId: PRINTER_SETTINGS_ID,
      // Field names only — a receipt footer is not worth copying into the
      // audit trail, and the trail's job here is "who changed the setup".
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { settings: publicPrinterSettings(settings) });
});

export default { getPrinterSettings, updatePrinterSettings };
