/**
 * ESC/POS — raw bytes for a thermal printer, via QZ Tray.
 *
 * ── Why raw rather than HTML ───────────────────────────────────────────────
 * QZ can rasterise HTML through the OS print pipeline, but doing so needs the
 * printer installed as a system driver rather than a raw port, and it
 * reintroduces exactly the pagination problems the browser path already has.
 * The only things QZ actually buys are a named printer, no dialog, and an
 * auto-cut — and all three are ESC/POS commands. Sending it HTML would be a
 * second transport with the same failure modes and none of the benefit.
 *
 * Hand-rolled rather than depending on `escpos` or `node-thermal-printer`:
 * those target Node, pull in serial/USB bindings that mean nothing in a
 * browser, and the command set actually needed here is about thirty bytes.
 */
import type { BillData, KotData, PaperWidth } from './types';
import { columnsFor } from './types';

// --- Commands ---------------------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;

const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_CENTER = [ESC, 0x61, 1];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];
/** GS ! n — the low nibble is height, the high nibble width. 0x11 = 2x both. */
const SIZE_NORMAL = [GS, 0x21, 0x00];
const SIZE_DOUBLE = [GS, 0x21, 0x11];
const FEED = (n: number) => [ESC, 0x64, n];
const CUT = [GS, 0x56, 0x42, 0x00];

/**
 * Money as it appears on a thermal receipt.
 *
 * ── The rupee sign is deliberately dropped ─────────────────────────────────
 * Most thermal heads have no `₹` glyph in their default code page and print a
 * question mark or garbage in its place. `Rs.` renders on every printer.
 *
 * The HTML path keeps the real `₹` because a rasterised print has no code page
 * and the browser has the font. That asymmetry is intentional — "fixing" it in
 * either direction breaks one of the two outputs.
 */
const money = (n: number) =>
  `Rs.${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A left-aligned label and a right-aligned value on one line.
 *
 * Truncates the LEFT side when the two cannot both fit: the amount is the part
 * a customer checks, so it is the part that survives.
 */
export function line(left: string, right: string, cols: number): string {
  const room = cols - right.length;
  if (room <= 0) return right.slice(0, cols);
  const label = left.length > room - 1 ? `${left.slice(0, Math.max(room - 2, 0))} ` : left;
  return label + ' '.repeat(Math.max(cols - label.length - right.length, 0)) + right;
}

/**
 * Wrap text to the column budget, indenting continuation lines by two spaces
 * so a long dish name reads as one item rather than two.
 */
export function wrap(text: string, cols: number, indent = 2): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const out: string[] = [];
  let current = '';
  const pad = ' '.repeat(indent);

  for (const word of words) {
    const width = out.length === 0 ? cols : cols - indent;
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) out.push(out.length === 0 ? current : pad + current);
    // A single word longer than the line gets hard-split; nothing else fits.
    current = word.length > width ? word.slice(0, width) : word;
  }
  if (current) out.push(out.length === 0 ? current : pad + current);
  return out;
}

const rule = (cols: number) => '-'.repeat(cols);

const timeOf = (d: Date) =>
  `${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;

// --- Builders ---------------------------------------------------------------

/** Accumulates text and commands in order, then flattens to bytes. */
class Buffer {
  private parts: Array<number[] | string> = [];

  cmd(bytes: number[]) {
    this.parts.push(bytes);
    return this;
  }

  text(s: string) {
    this.parts.push(`${s}\n`);
    return this;
  }

  bytes(): Uint8Array {
    const encoder = new TextEncoder();
    const chunks = this.parts.map((p) =>
      typeof p === 'string' ? encoder.encode(p) : Uint8Array.from(p),
    );
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** A kitchen ticket. Big numbers, no money. */
export function escposKot(data: KotData, paper: PaperWidth): Uint8Array {
  const cols = columnsFor(paper);
  const b = new Buffer();

  b.cmd(INIT).cmd(ALIGN_CENTER).cmd(BOLD_ON).cmd(SIZE_DOUBLE);
  b.text('KOT');
  b.cmd(SIZE_NORMAL);
  b.text(data.source);
  b.cmd(BOLD_OFF).cmd(ALIGN_LEFT);
  b.text(rule(cols));
  b.text(line(`Order #${data.orderNo}`, data.type, cols));
  b.text(timeOf(data.placedAt));
  b.text(rule(cols));

  for (const item of data.items) {
    b.cmd(BOLD_ON);
    for (const l of wrap(`${item.qty} x ${item.name}`, cols)) b.text(l);
    b.cmd(BOLD_OFF);
    // The note is why the kitchen reads the ticket twice — indent it, keep it.
    if (item.note) for (const l of wrap(`* ${item.note}`, cols)) b.text(l);
  }

  b.text(rule(cols));
  b.cmd(FEED(3)).cmd(CUT);
  return b.bytes();
}

/** A customer bill. */
export function escposBill(data: BillData, paper: PaperWidth): Uint8Array {
  const cols = columnsFor(paper);
  const b = new Buffer();

  b.cmd(INIT).cmd(ALIGN_CENTER).cmd(BOLD_ON);
  b.text(data.business.name);
  b.cmd(BOLD_OFF);
  if (data.business.address) for (const l of wrap(data.business.address, cols, 0)) b.text(l);
  if (data.business.phone) b.text(data.business.phone);
  if (data.business.gstNumber) b.text(`GSTIN: ${data.business.gstNumber}`);

  b.cmd(ALIGN_LEFT).text(rule(cols));
  b.text(line('Invoice', data.invoiceNo, cols));
  b.text(line('Order', `#${data.orderNo}`, cols));
  if (data.tableName) b.text(line('Table', data.tableName, cols));
  if (data.customerName) b.text(line('Customer', data.customerName, cols));
  b.text(line('Date', timeOf(data.paidAt ?? data.placedAt), cols));
  b.text(rule(cols));

  for (const item of data.items) {
    for (const l of wrap(item.name, cols)) b.text(l);
    b.text(line(`  ${item.qty} x ${money(item.unitPrice ?? 0)}`, money(item.lineTotal ?? 0), cols));
    if (item.note) for (const l of wrap(`* ${item.note}`, cols)) b.text(l);
  }

  b.text(rule(cols));
  b.text(line('Subtotal', money(data.subtotal), cols));
  // Rows that would read as a zero are omitted rather than printed as 0.00 —
  // a customer reading "Discount Rs.0.00" wonders what they missed.
  if (data.discount > 0) b.text(line('Discount', `-${money(data.discount)}`, cols));
  if (data.taxRate > 0) b.text(line(`GST (${data.taxRate}%)`, money(data.tax), cols));

  b.cmd(BOLD_ON).text(line('TOTAL', money(data.total), cols)).cmd(BOLD_OFF);
  b.text(rule(cols));
  b.text(
    data.paidAt
      ? line('Paid by', String(data.paymentMethod ?? '').toUpperCase(), cols)
      : '** UNPAID **',
  );

  if (data.business.footer) {
    b.cmd(ALIGN_CENTER);
    for (const l of wrap(data.business.footer, cols, 0)) b.text(l);
  }

  b.cmd(FEED(3)).cmd(CUT);
  return b.bytes();
}
