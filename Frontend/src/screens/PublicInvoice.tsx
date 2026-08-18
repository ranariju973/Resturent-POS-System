/**
 * The customer's receipt.
 *
 * ── Deliberately self-contained ────────────────────────────────────────────
 * No store, no AppShell, no auth, no shared layout. This is the only screen a
 * person who has never signed in will ever see, and it is opened by tapping a
 * link in WhatsApp on a phone. Every import it does not have is a thing that
 * cannot break for that person.
 *
 * It talks to the API directly rather than through `lib/api.ts` for the same
 * reason: that helper refreshes on a 401 and retries, which for an anonymous
 * visitor is a wasted round trip to an endpoint that will never succeed.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { BASE_URL } from '../lib/api';
import { money } from '../lib/format';

interface InvoiceLine {
  name: string;
  qty: number;
  note: string;
  unitPrice: number;
  lineTotal: number;
}

interface Invoice {
  invoiceNo: string;
  orderNo: number;
  status: 'paid' | 'voided';
  type: string;
  placedAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  tableName: string | null;
  customerName: string | null;
  items: InvoiceLine[];
  subtotal: number;
  discount: number;
  tax: number;
  taxRate: number;
  total: number;
  restaurant: { name: string; tagline: string };
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  'dine-in': 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

export function PublicInvoice({ slug }: { slug: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        /*
         * BASE_URL, not a bare relative path.
         *
         * This screen does not use the shared api() helper — it is the one
         * view with no session, and api() attaches a bearer token and retries
         * through /auth/refresh, neither of which a customer has. But dropping
         * the helper also dropped the thing it was quietly doing: prefixing
         * the API origin.
         *
         * In development that was invisible, because Vite proxies /api to the
         * backend and both are one origin. In production the frontend is on
         * Vercel and the API is on Render, and vercel.json's SPA rewrite
         * deliberately excludes /api/ — so a relative fetch here hit Vercel,
         * got a 404 HTML page, and every invoice link a customer opened said
         * "This invoice link is not valid."
         */
        const res = await fetch(`${BASE_URL}/api/invoice/${encodeURIComponent(slug)}`, {
          headers: { Accept: 'application/json' },
        });
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok || !body?.success) {
          // The server answers every failure the same way on purpose — see
          // invoiceController.js. Saying more here would undo that.
          setError('This invoice link is not valid. Please ask the restaurant for a new one.');
        } else {
          setInvoice(body.data.invoice as Invoice);
        }
      } catch {
        if (!cancelled) setError('Could not reach the restaurant. Check your connection.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) return <Centered>Loading your invoice…</Centered>;
  if (error || !invoice) return <Centered>{error}</Centered>;

  const voided = invoice.status === 'voided';

  return (
    <div style={page}>
      <div style={sheet} className="invoice-sheet">
        <header style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#006241', lineHeight: 1.2 }}>
            {invoice.restaurant.name}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
            {invoice.restaurant.tagline}
          </span>
        </header>

        {/*
          The status is the first thing a customer looks for, so it is a band
          rather than a line of text. A voided bill says so loudly — somebody
          re-opening this link months later must not read a cancelled bill as
          a receipt.
        */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 12,
            background: voided ? '#fdecea' : '#d4e9e2',
            color: voided ? '#c82014' : '#00754A',
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          <Icon
            icon={voided ? 'lucide:alert-triangle' : 'lucide:check-circle-2'}
            size={17}
            color={voided ? '#c82014' : '#00754A'}
          />
          {voided ? 'This bill was cancelled' : 'Paid'}
          {!voided && invoice.paymentMethod ? (
            <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>
              · {invoice.paymentMethod}
            </span>
          ) : null}
        </div>

        <dl style={metaGrid}>
          <Meta label="Invoice" value={invoice.invoiceNo} />
          <Meta label="Order" value={`#${invoice.orderNo}`} />
          <Meta
            label="Date"
            value={new Date(invoice.paidAt ?? invoice.placedAt).toLocaleString()}
          />
          <Meta label="Type" value={ORDER_TYPE_LABEL[invoice.type] ?? invoice.type} />
          {invoice.tableName ? <Meta label="Table" value={invoice.tableName} /> : null}
          {invoice.customerName ? <Meta label="Customer" value={invoice.customerName} /> : null}
        </dl>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {invoice.items.map((line, i) => (
            <div key={`${line.name}-${i}`} style={lineRow}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                  {line.name}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                  {line.qty} × {money(line.unitPrice)}
                  {line.note ? ` · ${line.note}` : ''}
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {money(line.lineTotal)}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Row label="Subtotal" value={money(invoice.subtotal)} />
          {invoice.discount > 0 ? (
            <Row label="Discount" value={`− ${money(invoice.discount)}`} />
          ) : null}
          {invoice.taxRate > 0 ? (
            <Row label={`Tax (${invoice.taxRate}%)`} value={money(invoice.tax)} />
          ) : null}
          <div style={{ height: 1, background: '#edebe9', margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Total</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: '#00754A' }}>
              {money(invoice.total)}
            </span>
          </div>
        </div>

        {/*
          `window.print()` rather than a generated PDF: every phone's print
          dialog offers "Save as PDF", so this is a real download with no
          library on either side and nothing stored on the server.
        */}
        <button
          type="button"
          className="press hv-primary no-print"
          onClick={() => window.print()}
          style={{
            marginTop: 4,
            padding: '13px 20px',
            borderRadius: 50,
            border: '1px solid #00754A',
            background: '#00754A',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Icon icon="lucide:printer" size={16} color="#ffffff" />
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <dt style={microLabel}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span style={{ color: 'rgba(0,0,0,0.58)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
      <p
        style={{
          margin: 0,
          maxWidth: 320,
          textAlign: 'center',
          fontSize: 14,
          fontWeight: 600,
          color: 'rgba(0,0,0,0.58)',
        }}
      >
        {children}
      </p>
    </div>
  );
}

const page: CSSProperties = {
  minHeight: '100dvh',
  background: '#f2f0eb',
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 14px 40px',
};

const sheet: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  margin: '0 auto',
  background: '#ffffff',
  borderRadius: 16,
  boxShadow: '0 0 0.5px rgba(0,0,0,0.14), 0 1px 1px rgba(0,0,0,0.24)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const metaGrid: CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 12,
  padding: '14px 0',
  borderTop: '1px solid #edebe9',
  borderBottom: '1px solid #edebe9',
};

const lineRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const microLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'rgba(0,0,0,0.45)',
};
