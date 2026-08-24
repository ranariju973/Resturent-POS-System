/**
 * Printer and receipt settings. Admin only — `settings:manage`.
 *
 * One document per restaurant (see models/PrinterSettings.js), so there is no
 * id to address and no list to page through: a GET and a PUT.
 *
 * Printer HARDWARE lives on that document. The business IDENTITY a receipt
 * prints — name, address, GST number, footer — lives on the Tenant, because
 * it describes the restaurant rather than the machine. This endpoint reads
 * both and returns one object, so the settings screen stays a single form.
 */
import { PrinterSettings, invalidateSettingsCache } from '../models/PrinterSettings.js';
import { Tenant } from '../models/Tenant.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { sendSuccess, asyncHandler } from '../utils/apiResponse.js';

/**
 * The shape the client works with.
 *
 * `effective*` fields resolve the fallback chain here rather than in the UI,
 * so the settings screen, the thermal bill and the public web invoice cannot
 * disagree about what the restaurant is called.
 */
export const publicPrinterSettings = (doc, tenant) => ({
  paperWidth: doc.paperWidth,
  billCopies: doc.billCopies,
  kotCopies: doc.kotCopies,
  kotPrinterName: doc.kotPrinterName ?? '',
  billPrinterName: doc.billPrinterName ?? '',

  /*
   * Identity, read from the Tenant.
   *
   * These were stored on the settings document with a hardcoded RESTAURANT
   * constant behind them, which meant two places described one fact and the
   * receipt renderer had to choose. There is now one source, and the
   * `effective*` pair below is what a receipt actually prints.
   */
  businessName: tenant?.name ?? '',
  businessAddress: tenant?.address ?? '',
  businessPhone: tenant?.phone ?? '',
  gstNumber: tenant?.gstNumber ?? '',
  footerLine: tenant?.footerLine ?? '',

  effectiveName: tenant?.name ?? '',
  effectiveFooter: tenant?.footerLine || tenant?.tagline || '',
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
  const [settings, tenant] = await Promise.all([
    PrinterSettings.load(),
    // Tenant is not itself tenant-scoped, so it is addressed by id.
    Tenant.findById(req.tenantId),
  ]);
  return sendSuccess(res, { settings: publicPrinterSettings(settings, tenant) });
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
  const { businessName, businessAddress, businessPhone, gstNumber, footerLine, ...hardware } =
    req.body;

  /*
   * The form is one screen but the storage is two documents, so the update is
   * split here rather than making the client know about the seam.
   *
   * An empty filter, because the plugin turns it into { tenantId } — the
   * unique index on that field is what makes this upsert a single document per
   * restaurant rather than a write that could fork the configuration.
   */
  const settings = await PrinterSettings.findOneAndUpdate(
    {},
    { $set: hardware },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );

  const identity = {};
  if (businessName !== undefined) identity.name = businessName;
  if (businessAddress !== undefined) identity.address = businessAddress;
  if (businessPhone !== undefined) identity.phone = businessPhone;
  if (gstNumber !== undefined) identity.gstNumber = gstNumber;
  if (footerLine !== undefined) identity.footerLine = footerLine;

  const tenant = Object.keys(identity).length
    ? await Tenant.findByIdAndUpdate(req.tenantId, { $set: identity }, {
      new: true,
      runValidators: true,
    })
    : await Tenant.findById(req.tenantId);

  // Drop the memo the public invoice route reads through, or a saved address
  // stays invisible on receipts for up to a minute.
  await invalidateSettingsCache();

  await AuditLog.record(
    {
      action: AUDIT_ACTION.SETTINGS_UPDATE,
      resource: 'PrinterSettings',
      resourceId: settings._id,
      // Field names only — a receipt footer is not worth copying into the
      // audit trail, and the trail's job here is "who changed the setup".
      meta: { fields: Object.keys(req.body) },
    },
    req,
  );

  return sendSuccess(res, { settings: publicPrinterSettings(settings, tenant) });
});

export default { getPrinterSettings, updatePrinterSettings };
