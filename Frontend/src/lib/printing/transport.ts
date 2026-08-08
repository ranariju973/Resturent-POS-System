/**
 * How a receipt reaches paper.
 *
 * Two mechanisms behind one interface: the browser's own print dialog, which
 * works on any device with nothing installed, and QZ Tray, which prints
 * silently to a named printer but needs a desktop daemon on that machine.
 *
 * ── Why the choice is per-terminal, not a database setting ─────────────────
 * It describes the MACHINE, not the business. A restaurant may run QZ on the
 * counter till and plain Chrome on a waiter's tablet; a global flag would have
 * the tablet dialling a `localhost` socket that cannot exist there.
 *
 * It also has to survive the server being unreachable — receipts get printed
 * exactly when the network is misbehaving, and a transport choice that needs a
 * successful API call to resolve is a dependency in the worst possible place.
 */
import type { BillData, KotData, PaperWidth } from './types';

export type TransportId = 'browser' | 'qz';

export interface PrintRequest {
  job: 'kot' | 'bill';
  /** Rendered markup, for a transport that prints a document. */
  html: string;
  /** The same receipt as data, for a transport that emits raw bytes. */
  data: KotData | BillData;
  paper: PaperWidth;
  copies: number;
  /** Named printer. Ignored by the browser, which cannot choose one. */
  printerName: string;
}

export interface PrintTransport {
  id: TransportId;
  label: string;
  /** Capability probe. Must never throw and must never hang. */
  available(): Promise<boolean>;
  print(req: PrintRequest): Promise<void>;
  /** Named printers, for the settings dropdowns. Empty under the browser. */
  listPrinters(): Promise<string[]>;
}

/** Where the per-terminal choice lives. Mirrors the `pos.shell.v1` convention. */
const STORAGE_KEY = 'pos.printer.v1';

export function readTransportPreference(): TransportId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'browser';
    const parsed = JSON.parse(raw) as { transport?: string };
    // Validated rather than trusted: a hand-edited or stale value must fall
    // back to the mechanism that always works, not throw on boot.
    return parsed.transport === 'qz' ? 'qz' : 'browser';
  } catch {
    return 'browser';
  }
}

export function writeTransportPreference(transport: TransportId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ transport }));
  } catch {
    /* Private browsing refuses writes. The session default still applies. */
  }
}
