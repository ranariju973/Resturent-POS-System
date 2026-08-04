import type { CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { CONFIG, usePos } from '../store';
import { CURRENCY, money, plural } from '../lib/format';
import { CARD_SHADOW, FilterPill, PageHeading, SearchInput } from '../components/ui';

export function Billing() {
  const { state, actions } = usePos();

  const query = state.query.trim().toLowerCase();
  const qtyOf = (id: string) => state.cart.find((l) => l.id === id)?.qty ?? 0;

  const products = state.items.filter(
    (p) =>
      p.available &&
      (state.cat === 'Show All' || p.cat === state.cat) &&
      (!query || p.name.toLowerCase().includes(query)),
  );

  const lines = state.cart.flatMap((line) => {
    const item = state.items.find((x) => x.id === line.id);
    return item ? [{ line, item, lineTotal: item.price * line.qty }] : [];
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const rawDiscount = parseFloat(state.discountValue) || 0;
  const discount = Math.min(
    state.discountMode === 'pct' ? (subtotal * rawDiscount) / 100 : rawDiscount,
    subtotal,
  );
  const count = lines.reduce((sum, l) => sum + l.line.qty, 0);
  const hasName = state.customer.trim().length > 0;
  const nameMissing = CONFIG.requireCustomerName && !hasName;
  const canGenerate = count > 0 && !nameMissing;

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', gap: 24, padding: 24 }}>
      <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHeading
          title="POS Billing"
          subtitle="Tap an item to add it to the order"
          right={
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
              {plural(products.length, 'item')}
            </span>
          }
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            background: '#ffffff',
            borderRadius: 12,
            padding: 16,
            boxShadow: CARD_SHADOW,
          }}
        >
          <SearchInput
            placeholder="Search in products"
            value={state.query}
            onChange={(query) => actions.patch({ query })}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Show All', ...state.cats.map((c) => c.name)].map((name) => (
              <FilterPill
                key={name}
                label={name}
                active={name === state.cat}
                onClick={() => actions.patch({ cat: name })}
              />
            ))}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '2px 4px 4px 2px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(178px, 1fr))',
              gap: 16,
              alignContent: 'start',
            }}
          >
            {products.map((p) => {
              const qty = qtyOf(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="press hv-green-border"
                  onClick={() => actions.addToCart(p.id)}
                  style={{
                    position: 'relative',
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.07)',
                    background: '#ffffff',
                    boxShadow: CARD_SHADOW,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <img
                    src={p.img}
                    alt={p.name}
                    style={{
                      width: '100%',
                      height: 104,
                      borderRadius: 10,
                      objectFit: 'cover',
                      display: 'block',
                      background: '#edebe9',
                    }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'rgba(0,0,0,0.87)',
                        lineHeight: 1.3,
                      }}
                    >
                      {p.name}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#00754A' }}>
                        {money(p.price)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                        {p.cat}
                      </span>
                    </span>
                  </span>
                  {qty > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        minWidth: 24,
                        height: 24,
                        padding: '0 7px',
                        borderRadius: 50,
                        background: '#00754A',
                        color: '#ffffff',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 6px rgba(0,0,0,0.24)',
                        animation: 'badgePop 0.18s ease-out',
                      }}
                    >
                      {qty}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {products.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: '8px 0 4px',
                textAlign: 'center',
                fontSize: 14,
                fontWeight: 500,
                color: 'rgba(0,0,0,0.58)',
              }}
            >
              No items match that search.
            </p>
          ) : null}
        </div>
      </section>

      <aside
        style={{
          width: 400,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: CARD_SHADOW,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            borderBottom: '1px solid #edebe9',
          }}
        >
          <div
            style={{
              border: `1px solid ${nameMissing ? '#cba258' : '#d6dbde'}`,
              borderRadius: 12,
              padding: '8px 14px 10px',
              background: '#ffffff',
            }}
          >
            <label
              htmlFor="cust"
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: nameMissing ? '#8a6a24' : 'rgba(0,0,0,0.58)',
              }}
            >
              Customer name {nameMissing ? '· required' : ''}
            </label>
            <input
              id="cust"
              type="text"
              placeholder="e.g. Aarav Mehta"
              value={state.customer}
              onChange={(e) => actions.patch({ customer: e.target.value })}
              style={{
                width: '100%',
                marginTop: 3,
                border: 0,
                padding: 0,
                fontSize: 15,
                fontWeight: 600,
                color: 'rgba(0,0,0,0.87)',
                background: 'transparent',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon icon="lucide:receipt" size={17} color="#00754A" />
              <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                Order #{CONFIG.orderNumber}
              </span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
              {plural(count, 'item')}
            </span>
          </div>

          {state.orderTable ? (
            <button
              type="button"
              className="press"
              title="Clear table"
              onClick={() => actions.patch({ orderTable: null })}
              style={{
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 14px',
                borderRadius: 50,
                border: '1px solid #00754A',
                background: '#d4e9e2',
                color: '#1E3932',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <Icon icon="lucide:utensils" size={13} />
              Table {state.orderTable}
              <Icon icon="lucide:x" size={13} color="#00754A" />
            </button>
          ) : null}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {lines.map(({ line, item, lineTotal }) => (
            <div
              key={line.id}
              style={{
                border: '1px solid rgba(0,0,0,0.07)',
                borderRadius: 12,
                padding: 12,
                background: '#f9f9f9',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                    {item.name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
                    {money(item.price)} × {line.qty}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#00754A' }}>
                    {money(lineTotal)}
                  </span>
                  <button
                    type="button"
                    className="press hv-danger"
                    title="Remove item"
                    onClick={() => actions.removeLine(line.id)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: '1px solid #d6dbde',
                      background: '#ffffff',
                      color: 'rgba(0,0,0,0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon icon="lucide:trash-2" size={14} />
                  </button>
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="press hv-green"
                    onClick={() => actions.bumpQty(line.id, -1)}
                    style={stepperButton}
                  >
                    −
                  </button>
                  <span
                    style={{ minWidth: 18, textAlign: 'center', fontSize: 15, fontWeight: 700 }}
                  >
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    className="press"
                    onClick={() => actions.bumpQty(line.id, 1)}
                    style={{
                      ...stepperButton,
                      border: '1px solid #00754A',
                      background: '#00754A',
                      color: '#ffffff',
                    }}
                  >
                    +
                  </button>
                </span>
                <button
                  type="button"
                  className="press hv-green"
                  onClick={() => actions.patchLine(line.id, { noteOpen: !line.noteOpen })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 50,
                    border: '1px solid #d6dbde',
                    background: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'rgba(0,0,0,0.58)',
                  }}
                >
                  <Icon icon="lucide:pencil-line" size={13} />
                  {line.note ? 'Note added' : 'Add note'}
                </button>
              </div>

              {line.noteOpen ? (
                <input
                  type="text"
                  className="focus-green"
                  placeholder="Kitchen note — e.g. no onions"
                  value={line.note}
                  onChange={(e) => actions.patchLine(line.id, { note: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '9px 14px',
                    borderRadius: 50,
                    border: '1px solid #d6dbde',
                    background: '#ffffff',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              ) : null}
            </div>
          ))}

          {state.cart.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                padding: '40px 24px',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: '#f2f0eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00754A',
                }}
              >
                <Icon icon="lucide:shopping-bag" size={30} />
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                No items yet
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'rgba(0,0,0,0.58)',
                  lineHeight: 1.5,
                  maxWidth: 220,
                }}
              >
                Tap items from the menu and they will show up here, ready to bill.
              </span>
            </div>
          ) : null}
        </div>

        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid #edebe9',
            background: '#ffffff',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid #d6dbde',
                borderRadius: 50,
                padding: '8px 14px',
              }}
            >
              <Icon icon="lucide:badge-percent" color="rgba(0,0,0,0.45)" />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'rgba(0,0,0,0.58)',
                  whiteSpace: 'nowrap',
                }}
              >
                Discount
              </span>
              <input
                type="text"
                value={state.discountValue}
                onChange={(e) => actions.patch({ discountValue: e.target.value })}
                style={{
                  flex: 1,
                  minWidth: 24,
                  border: 0,
                  padding: 0,
                  textAlign: 'right',
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.87)',
                  background: 'transparent',
                  outline: 'none',
                }}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.58)',
                  flexShrink: 0,
                }}
              >
                {state.discountMode === 'pct' ? '%' : CURRENCY}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 4,
                padding: 3,
                borderRadius: 50,
                background: '#f2f0eb',
                flexShrink: 0,
              }}
            >
              <DiscountMode
                label={CURRENCY}
                active={state.discountMode === 'flat'}
                onClick={() => actions.patch({ discountMode: 'flat' })}
              />
              <DiscountMode
                label="%"
                active={state.discountMode === 'pct'}
                onClick={() => actions.patch({ discountMode: 'pct' })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <SummaryRow label="Subtotal" value={money(subtotal)} />
            <SummaryRow
              label="Discount"
              value={`${discount > 0 ? '− ' : ''}${money(discount)}`}
            />
            {CONFIG.showTaxRow ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  color: 'rgba(0,0,0,0.32)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                  Tax
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '2px 7px',
                      borderRadius: 50,
                      background: '#f2f0eb',
                      color: 'rgba(0,0,0,0.32)',
                    }}
                  >
                    Later
                  </span>
                </span>
                <span style={{ fontWeight: 600 }}>—</span>
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 10,
                borderTop: '1px solid #edebe9',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                Total
              </span>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#00754A', lineHeight: 1.1 }}>
                {money(Math.max(subtotal - discount, 0))}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canGenerate ? (
              <button
                type="button"
                className="press hv-primary"
                onClick={() => actions.flash(`Bill generated for ${state.customer.trim()}`)}
                style={generateButton}
              >
                <Icon icon="lucide:file-check-2" size={17} />
                Generate Bill
              </button>
            ) : (
              <button
                type="button"
                disabled
                title={count === 0 ? 'Add an item to bill' : 'Enter customer name'}
                style={{
                  ...generateButton,
                  border: '1px solid #edebe9',
                  background: '#edebe9',
                  color: 'rgba(0,0,0,0.32)',
                  cursor: 'not-allowed',
                }}
              >
                <Icon icon="lucide:lock" size={16} />
                {count === 0 ? 'Add an item to bill' : 'Enter customer name'}
              </button>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="press hv-green-fill"
                onClick={() => actions.flash('Kitchen ticket sent to printer')}
                style={outlineGreenButton}
              >
                <Icon icon="lucide:printer" size={15} />
                Print KOT
              </button>
              <button
                type="button"
                className="press hv-green-fill"
                onClick={() => actions.flash('Bill sent to receipt printer')}
                style={outlineGreenButton}
              >
                <Icon icon="lucide:receipt-text" size={15} />
                Print Bill
              </button>
            </div>

            <button
              type="button"
              className="press hv-green"
              onClick={() => actions.patch({ sendOpen: !state.sendOpen })}
              style={{
                width: '100%',
                padding: '11px 18px',
                borderRadius: 50,
                border: '1px solid #d6dbde',
                background: '#ffffff',
                color: 'rgba(0,0,0,0.87)',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
              }}
            >
              <Icon icon="lucide:send" size={15} />
              Send Invoice
              <Icon
                icon={state.sendOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'}
                size={15}
                color="rgba(0,0,0,0.45)"
              />
            </button>

            {state.sendOpen ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="press hv-green"
                  onClick={() => {
                    actions.patch({ sendOpen: false });
                    actions.flash('Invoice sent on WhatsApp');
                  }}
                  style={sendOptionButton}
                >
                  <Icon icon="lucide:message-circle" size={15} />
                  WhatsApp
                </button>
                <button
                  type="button"
                  className="press hv-green"
                  onClick={() => {
                    actions.patch({ sendOpen: false });
                    actions.flash('Invoice sent by SMS');
                  }}
                  style={sendOptionButton}
                >
                  <Icon icon="lucide:message-square" size={15} />
                  SMS
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </main>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 14,
      }}
    >
      <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>{value}</span>
    </div>
  );
}

function DiscountMode({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        padding: '6px 13px',
        borderRadius: 50,
        border: 0,
        fontSize: 13,
        fontWeight: 700,
        background: active ? '#ffffff' : 'transparent',
        color: active ? '#00754A' : 'rgba(0,0,0,0.45)',
      }}
    >
      {label}
    </button>
  );
}

const stepperButton: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 16,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const generateButton: CSSProperties = {
  width: '100%',
  padding: '13px 24px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#00754A',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const outlineGreenButton: CSSProperties = {
  flex: 1,
  padding: '11px 14px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#ffffff',
  color: '#00754A',
  fontSize: 13,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
};

const sendOptionButton: CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#f9f9f9',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 13,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
};
