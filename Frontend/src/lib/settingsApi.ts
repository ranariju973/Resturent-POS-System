/**
 * Printer and receipt settings. Admin only — every call here 403s otherwise.
 *
 * One document for the whole restaurant, so there is no id and no list: a read
 * and a write.
 */
import { api } from './api';
import type { PrinterSettings } from './printing/types';

export async function getPrinterSettings(signal?: AbortSignal): Promise<PrinterSettings> {
  const data = await api<{ settings: PrinterSettings }>('/api/settings/printer', { signal });
  return data.settings;
}

/**
 * Save. Every field is optional server-side and merged, so a partial submit
 * leaves the omitted fields alone rather than blanking them.
 */
export async function updatePrinterSettings(
  input: Partial<Omit<PrinterSettings, 'effectiveName' | 'effectiveFooter'>>,
): Promise<PrinterSettings> {
  const data = await api<{ settings: PrinterSettings }>('/api/settings/printer', {
    method: 'PUT',
    body: input,
  });
  return data.settings;
}
