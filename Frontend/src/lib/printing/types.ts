/**
 * What a receipt is made of.
 *
 * ── One data shape, two renderers ──────────────────────────────────────────
 * The React templates and the ESC/POS encoder both consume these types and
 * neither reads the other's output. That is deliberate: it is what keeps a
 * browser print and a thermal print showing the same receipt. Add a field and
 * the missing branch shows up as a visible gap in one file, rather than as two
 * receipts that quietly disagree.
 */

/** Millimetres of paper. Decides the column budget — see `columnsFor`. */
export type PaperWidth = 58 | 80;

/**
 * Characters per line at the printer's default font.
 *
 * These are the standard Font A widths for 58mm and 80mm heads. The HTML
 * templates use a monospace face at a matching size so a receipt printed
 * through the browser lines up the same way as one printed as raw bytes.
 */
export const columnsFor = (paper: PaperWidth): number => (paper === 58 ? 32 : 48);

export interface ReceiptLine {
  name: string;
  qty: number;
  note: string;
  /** Major units. Absent on a kitchen ticket, which never shows money. */
  unitPrice?: number;
  lineTotal?: number;
}

/** The business identity printed at the top of a customer bill. */
export interface ReceiptBusiness {
  name: string;
  address: string;
  phone: string;
  gstNumber: string;
  footer: string;
}

/**
 * A kitchen ticket.
 *
 * No prices, no totals, no address. A kitchen printer that spends three lines
 * on a GST number spends them on every ticket of every service.
 */
export interface KotData {
  orderNo: number;
  /** 'Table T3' | 'Takeaway' | 'Delivery' — what the expo needs to route it. */
  source: string;
  type: string;
  placedAt: Date;
  items: ReceiptLine[];
}

/** A customer bill. */
export interface BillData {
  invoiceNo: string;
  orderNo: number;
  business: ReceiptBusiness;
  tableName: string | null;
  customerName: string | null;
  placedAt: Date;
  /** Null while the bill is unpaid — the template then prints UNPAID. */
  paidAt: Date | null;
  paymentMethod: string | null;
  items: ReceiptLine[];
  subtotal: number;
  discount: number;
  tax: number;
  taxRate: number;
  total: number;
}

export interface PrinterSettings {
  paperWidth: PaperWidth;
  billCopies: number;
  kotCopies: number;
  kotPrinterName: string;
  billPrinterName: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  gstNumber: string;
  footerLine: string;
  /** What a receipt will actually print, after the server applies fallbacks. */
  effectiveName: string;
  effectiveFooter: string;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  paperWidth: 80,
  billCopies: 1,
  kotCopies: 1,
  kotPrinterName: '',
  billPrinterName: '',
  businessName: '',
  businessAddress: '',
  businessPhone: '',
  gstNumber: '',
  footerLine: '',
  effectiveName: 'Kimche Restora',
  effectiveFooter: 'Thank you for dining with us',
};
