/**
 * The print entry point the rest of the app calls.
 *
 * Picks a transport, renders the receipt, and degrades to the browser when the
 * preferred mechanism is unreachable — printing a receipt through a dialog is
 * always better than refusing to print because a daemon is down.
 */
import { billHtml, kotHtml } from '../../components/print/receiptHtml';
import { browserTransport } from './browserTransport';
import {
  readTransportPreference,
  type PrintTransport,
  type TransportId,
} from './transport';
import type { BillData, KotData, PrinterSettings } from './types';

/**
 * QZ is probed once per session and cached.
 *
 * Probing on every print puts a round trip on the hot path for an answer that
 * almost never changes mid-shift; the settings screen offers a manual
 * re-check for the case where it does.
 */
let qzCache: { available: boolean; at: number } | null = null;

/** Loaded on demand, so browser-only terminals never download the library. */
async function loadQz(): Promise<PrintTransport | null> {
  try {
    const mod = await import('./qzTransport');
    return mod.qzTransport;
  } catch {
    // Not installed as a dependency yet, or failed to load. Either way the
    // browser path covers it.
    return null;
  }
}

export function clearQzProbeCache(): void {
  qzCache = null;
}

export async function isQzAvailable(): Promise<boolean> {
  if (qzCache && Date.now() - qzCache.at < 5 * 60_000) return qzCache.available;
  const qz = await loadQz();
  const available = qz ? await qz.available().catch(() => false) : false;
  qzCache = { available, at: Date.now() };
  return available;
}

/** The transport to use right now, and whether it is the one that was asked for. */
async function resolveTransport(): Promise<{ transport: PrintTransport; degraded: boolean }> {
  if (readTransportPreference() !== 'qz') return { transport: browserTransport, degraded: false };

  const qz = await loadQz();
  if (qz && (await isQzAvailable())) return { transport: qz, degraded: false };

  // Asked for QZ, could not have it. Print anyway and say so.
  return { transport: browserTransport, degraded: true };
}

/** Printer names this machine offers, for the settings dropdowns. */
export async function listQzPrinters(): Promise<string[]> {
  const qz = await loadQz();
  if (!qz) return [];
  return qz.listPrinters().catch(() => []);
}

export interface PrintOutcome {
  /** True when QZ was requested but the browser was used instead. */
  degraded: boolean;
  transport: TransportId;
}

export async function printKot(
  data: KotData,
  settings: PrinterSettings,
): Promise<PrintOutcome> {
  const { transport, degraded } = await resolveTransport();
  await transport.print({
    job: 'kot',
    html: kotHtml(data, settings.paperWidth),
    data,
    paper: settings.paperWidth,
    copies: settings.kotCopies,
    printerName: settings.kotPrinterName,
  });
  return { degraded, transport: transport.id };
}

export async function printBill(
  data: BillData,
  settings: PrinterSettings,
): Promise<PrintOutcome> {
  const { transport, degraded } = await resolveTransport();
  await transport.print({
    job: 'bill',
    html: billHtml(data, settings.paperWidth),
    data,
    paper: settings.paperWidth,
    copies: settings.billCopies,
    printerName: settings.billPrinterName,
  });
  return { degraded, transport: transport.id };
}

export { billHtml, kotHtml };
export * from './types';
export { readTransportPreference, writeTransportPreference } from './transport';
