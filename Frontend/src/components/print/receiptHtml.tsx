/**
 * The two receipt layouts, as HTML strings.
 *
 * ── Why strings and not React components ───────────────────────────────────
 * These are rendered into a separate document (see lib/printing/printFrame.ts)
 * where React has no root and no reason to have one — the markup is written
 * once and immediately handed to a print dialog. Building it as a string skips
 * mounting a second React tree with its own commit timing, and makes the
 * output trivially inspectable in a settings preview.
 *
 * The layout is deliberately plain: no shared `ui.tsx` primitives, which carry
 * shadows, rounded corners and brand green — all meaningless to a one-bit
 * thermal head, and all wasted ink on the printers that do render them.
 */
import type { BillData, KotData, PaperWidth } from '../../lib/printing/types';

/** Text going into markup. Small, but this is user-entered business data. */
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

/**
 * The browser path keeps the real rupee sign — a rasterised print has no code
 * page and the font has the glyph. The ESC/POS path substitutes `Rs.` because
 * most thermal heads do not. See escpos.ts; the difference is intentional.
 */
const money = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (d: Date) =>
  `${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;

const RULE = '<div style="border-top:1px dashed #000;margin:6px 0"></div>';

/** A label/value row. `flex` here is what `line()` does in characters. */
const row = (label: string, value: string, bold = false) =>
  `<div style="display:flex;justify-content:space-between;gap:8px${bold ? ';font-weight:700' : ''}">
     <span>${esc(label)}</span><span style="white-space:nowrap">${esc(value)}</span>
   </div>`;

/**
 * A kitchen ticket.
 *
 * No prices, no totals, no business header. A kitchen printer that spends
 * three lines on a GST number spends them on every ticket of every service —
 * and the cook has no use for any of it.
 */
export function kotHtml(data: KotData, paper: PaperWidth): string {
  const items = data.items
    .map(
      (item) => `
      <div style="margin:5px 0;break-inside:avoid">
        <div style="font-weight:700;font-size:${paper === 58 ? 13 : 15}px">
          ${esc(item.qty)} × ${esc(item.name)}
        </div>
        ${item.note ? `<div style="padding-left:10px;font-style:italic">* ${esc(item.note)}</div>` : ''}
      </div>`,
    )
    .join('');

  return `
    <div style="text-align:center;font-weight:700;font-size:${paper === 58 ? 20 : 24}px">KOT</div>
    <div style="text-align:center;font-weight:700;font-size:${paper === 58 ? 14 : 16}px">
      ${esc(data.source)}
    </div>
    ${RULE}
    ${row(`Order #${data.orderNo}`, data.type)}
    <div>${esc(when(data.placedAt))}</div>
    ${RULE}
    ${items}
    ${RULE}
  `;
}

/** A customer bill. */
export function billHtml(data: BillData, paper: PaperWidth): string {
  const b = data.business;

  const items = data.items
    .map(
      (item) => `
      <div style="margin:4px 0;break-inside:avoid">
        <div>${esc(item.name)}</div>
        ${row(`  ${item.qty} × ${money(item.unitPrice ?? 0)}`, money(item.lineTotal ?? 0))}
        ${item.note ? `<div style="padding-left:10px;font-style:italic">* ${esc(item.note)}</div>` : ''}
      </div>`,
    )
    .join('');

  return `
    <div style="text-align:center">
      <div style="font-weight:700;font-size:${paper === 58 ? 14 : 16}px">${esc(b.name)}</div>
      ${b.address ? `<div>${esc(b.address)}</div>` : ''}
      ${b.phone ? `<div>${esc(b.phone)}</div>` : ''}
      ${b.gstNumber ? `<div>GSTIN: ${esc(b.gstNumber)}</div>` : ''}
    </div>
    ${RULE}
    ${row('Invoice', data.invoiceNo)}
    ${row('Order', `#${data.orderNo}`)}
    ${data.tableName ? row('Table', data.tableName) : ''}
    ${data.customerName ? row('Customer', data.customerName) : ''}
    ${row('Date', when(data.paidAt ?? data.placedAt))}
    ${RULE}
    ${items}
    ${RULE}
    ${row('Subtotal', money(data.subtotal))}
    ${data.discount > 0 ? row('Discount', `− ${money(data.discount)}`) : ''}
    ${data.taxRate > 0 ? row(`GST (${data.taxRate}%)`, money(data.tax)) : ''}
    ${RULE}
    ${row('TOTAL', money(data.total), true)}
    ${RULE}
    <div style="text-align:center;font-weight:700">
      ${data.paidAt ? `Paid by ${esc(String(data.paymentMethod ?? '').toUpperCase())}` : '** UNPAID **'}
    </div>
    ${b.footer ? `<div style="text-align:center;margin-top:6px">${esc(b.footer)}</div>` : ''}
  `;
}
