/**
 * The customer-facing invoice URL.
 *
 * ── The slug is two things joined ──────────────────────────────────────────
 *   INV-20260806-0041-K3n8_pQr…
 *   └──── legible ───┘└─ secret ─┘
 *
 * The invoice number is there for humans: it appears in a WhatsApp thread
 * months later, and "which bill is this?" should be answerable without opening
 * it. It is also sequential, which means it is guessable — on its own it would
 * let anyone increment the digits and read every bill the restaurant took that
 * day, names and phone numbers included.
 *
 * The token is what actually protects the link. The number is verified against
 * the order the token found, so a mismatched pair is refused rather than
 * quietly serving whichever half matched.
 */
import { env } from '../config/env.js';

/** The separator between the invoice number and the token. */
const SLUG_JOIN = '-';

/**
 * Compose the slug that appears in the URL.
 * @param {string} invoiceNo e.g. 'INV-20260806-0041'
 * @param {string} token     raw, never the stored hash
 */
export const buildInvoiceSlug = (invoiceNo, token) => `${invoiceNo}${SLUG_JOIN}${token}`;

/**
 * Split a slug back into its parts.
 *
 * The invoice number is a fixed shape — `INV-` plus 8 digits plus 4 — so the
 * split is taken from the front rather than by counting hyphens from the back.
 * A token is base64url and may itself contain `-`, which is precisely why
 * `slug.split('-')` would be wrong.
 *
 * @returns {{ invoiceNo: string, token: string } | null} null when malformed.
 */
export function parseInvoiceSlug(slug) {
  const match = /^(INV-\d{8}-\d{4})-(.+)$/.exec(String(slug ?? ''));
  if (!match) return null;
  return { invoiceNo: match[1], token: match[2] };
}

/**
 * The full URL to hand a customer.
 *
 * Built server-side so the client never has to know the public origin, and so
 * a misconfigured frontend cannot mint links to the wrong host. `publicAppUrl`
 * is already trailing-slash-free (see config/env.js).
 */
export const buildInvoiceUrl = (invoiceNo, token) =>
  `${env.publicAppUrl}/invoice/${buildInvoiceSlug(invoiceNo, token)}`;

export default { buildInvoiceSlug, parseInvoiceSlug, buildInvoiceUrl };
