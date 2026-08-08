/**
 * QZ Tray — silent printing to a named printer.
 *
 * ── What this buys, and what it costs ──────────────────────────────────────
 * Buys: a named printer per job, no print dialog, and an auto-cut. Those are
 * the three things a web page fundamentally cannot do, and the only reasons to
 * install anything.
 *
 * Costs: a Java daemon running on that machine, listening on localhost:8181.
 * So this is a per-terminal choice — the counter till may have it while a
 * waiter's tablet never will.
 *
 * ── Unsigned, deliberately, for now ────────────────────────────────────────
 * Truly silent printing requires a purchased certificate and a server endpoint
 * holding its private key — the key must never reach the browser. Unsigned, QZ
 * shows a one-time "allow this site to print?" prompt per origin, which a user
 * can remember. That is an acceptable trade against a certificate purchase and
 * a new authenticated signing route, and the upgrade path is additive.
 *
 * The library is imported dynamically by lib/printing/index.ts, so a terminal
 * that never uses QZ never downloads it.
 */
import { escposBill, escposKot } from './escpos';
import type { BillData, KotData } from './types';
import type { PrintRequest, PrintTransport } from './transport';

/** The daemon is local; a machine without it must fail fast, not hang. */
const PROBE_TIMEOUT_MS = 1500;

type QzModule = typeof import('qz-tray');
let qz: QzModule | null = null;

async function lib(): Promise<QzModule> {
  if (!qz) qz = await import('qz-tray');
  return qz;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

async function connect(): Promise<void> {
  const q = await lib();
  if (q.websocket.isActive()) return;
  await withTimeout(q.websocket.connect({ retries: 0, delay: 0 }), PROBE_TIMEOUT_MS);
}

/** Base64 for QZ's raw flavour. Chunked so a long receipt cannot blow the stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export const qzTransport: PrintTransport = {
  id: 'qz',
  label: 'QZ Tray',

  /** Never throws — a failed probe is an answer, not an error. */
  async available() {
    try {
      await connect();
      return true;
    } catch {
      return false;
    }
  },

  async print(req: PrintRequest) {
    const q = await lib();
    await connect();

    const bytes =
      req.job === 'kot'
        ? escposKot(req.data as KotData, req.paper)
        : escposBill(req.data as BillData, req.paper);

    /*
     * A blank name means "whatever QZ considers default" — a restaurant with
     * one printer should not have to name it before anything prints.
     *
     * But a machine with NO printer installed has no default either, and
     * `configs.create(undefined)` fails somewhere deep inside QZ with a
     * message about a null queue. Catching it here turns that into something
     * a cashier can act on, which matters because "QZ is connected but
     * nothing prints" is otherwise a genuinely confusing state.
     */
    const printer = req.printerName || (await q.printers.getDefault().catch(() => ''));
    if (!printer) {
      throw new Error(
        'No printer is set up on this computer. Add one in System Settings, ' +
          'or name it on the Printers tab.',
      );
    }

    const config = q.configs.create(printer, { copies: Math.max(1, req.copies) });

    await q.print(config, [{ type: 'raw', format: 'command', flavor: 'base64', data: toBase64(bytes) }]);
  },

  async listPrinters() {
    try {
      await connect();
      const q = await lib();
      return await q.printers.find();
    } catch {
      // The settings screen shows an empty list and an explanation rather than
      // an error — not having QZ is an ordinary state, not a fault.
      return [];
    }
  },
};
