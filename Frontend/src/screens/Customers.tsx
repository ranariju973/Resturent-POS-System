import { useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { PERMISSIONS, can } from '../lib/permissions';
import { money, plural } from '../lib/format';
import { useIsMobile } from '../lib/useViewport';
import {
  ErrorLine,
  Field,
  IconButton,
  ModalActions,
  ModalOverlay,
  ModalTitle,
  PageHeading,
  SearchInput,
  StatusBadge,
  bareInput,
  card,
  primaryPill,
} from '../components/ui';

export function Customers() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();
  const mayDelete = can(state.user?.permissions, PERMISSIONS.CUSTOMER_DELETE);

  useEffect(() => {
    void actions.loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = state.custQuery.trim().toLowerCase();
  const list = state.customers.filter(
    (c) =>
      !query ||
      c.name.toLowerCase().includes(query) ||
      c.phone.replace(/\s/g, '').includes(query.replace(/\s/g, '')),
  );
  const selected = state.customers.find((c) => c.id === state.selCust);

  return (
    <>
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: isMobile ? 14 : 24,
        }}
      >
        <PageHeading
          title="Customers"
          subtitle="Records and past orders"
          right={
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
              {plural(state.customers.length, 'customer')}
            </span>
          }
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: isMobile ? 0 : 24,
            overflowX: isMobile ? 'visible' : 'auto',
          }}
        >
          <section
            style={{
              ...card,
              // On a phone the list IS the screen until somebody is picked;
              // then it steps aside for the detail rather than shrinking.
              width: isMobile ? '100%' : 320,
              flexShrink: 0,
              display: isMobile && selected ? 'none' : 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: isMobile ? 12 : 16,
            }}
          >
            <SearchInput
              placeholder="Search name or phone"
              value={state.custQuery}
              onChange={(custQuery) => actions.patch({ custQuery })}
            />

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                paddingRight: 2,
              }}
            >
              {list.map((customer) => {
                const active = customer.id === state.selCust;
                return (
                  <button
                    key={customer.id}
                    type="button"
                    className="press"
                    onClick={() => void actions.selectCustomer(customer.id)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: active ? '#d4e9e2' : '#ffffff',
                      border: `1px solid ${active ? '#00754A' : '#edebe9'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: active ? '#1E3932' : 'rgba(0,0,0,0.87)',
                      }}
                    >
                      {customer.name}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
                      {customer.phone}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'rgba(0,0,0,0.45)',
                      }}
                    >
                      <span>Last visit {customer.last || 'never'}</span>
                      <span>{plural(customer.orderCount, 'order')}</span>
                    </span>
                  </button>
                );
              })}

              {list.length === 0 ? (
                <p
                  style={{
                    margin: 0,
                    padding: '24px 8px',
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'rgba(0,0,0,0.58)',
                  }}
                >
                  No customer matches that search.
                </p>
              ) : null}
            </div>
          </section>

          <section
            style={{
              ...card,
              flex: 1,
              minWidth: isMobile ? 0 : 340,
              display: isMobile && !selected ? 'none' : 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {selected ? (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    flexShrink: 0,
                    padding: 20,
                    borderBottom: '1px solid #edebe9',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      flex: '1 1 200px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* The list is hidden while this is open, so without a
                          way back a phone user is stuck on one customer. */}
                      {isMobile ? (
                        <IconButton
                          icon="lucide:chevron-left"
                          title="Back to the list"
                          iconSize={16}
                          size={32}
                          onClick={() => actions.patch({ selCust: null })}
                        />
                      ) : null}
                      <span
                        style={{
                          fontSize: isMobile ? 18 : 21,
                          fontWeight: 800,
                          color: 'rgba(0,0,0,0.87)',
                          lineHeight: 1.15,
                        }}
                      >
                        {selected.name}
                      </span>
                      <IconButton
                        icon="lucide:pencil"
                        title="Edit customer"
                        iconSize={14}
                        size={30}
                        onClick={() => actions.openCustModal(selected)}
                      />
                      {/*
                        Admin only. The screen hides it and the route refuses
                        it — the second of those is what actually enforces it.
                      */}
                      {mayDelete ? (
                        <IconButton
                          icon="lucide:trash-2"
                          title="Remove customer"
                          iconSize={14}
                          size={30}
                          busy={state.custSaving}
                          onClick={() => {
                            const ok = window.confirm(
                              `Remove ${selected.name}? Their order history stays on the orders themselves.`,
                            );
                            if (ok) void actions.deleteCustomer(selected.id);
                          }}
                        />
                      ) : null}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
                      {selected.phone}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                      {selected.email || 'No email on file'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="press hv-primary"
                    onClick={() => actions.orderForCustomer(selected)}
                    style={{ ...primaryPill, flex: '0 1 auto', padding: '12px 20px' }}
                  >
                    <Icon icon="lucide:plus" />
                    New Order for this Customer
                  </button>
                </div>

                <div
                  style={{
                    flexShrink: 0,
                    padding: '16px 20px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))',
                    gap: 12,
                  }}
                >
                  {/*
                    All three come from the server now. They used to be derived
                    from `history`, which the list endpoint never returns — so
                    every customer showed 0 orders and no spend regardless of
                    how much they had bought. Lifetime spend in particular was
                    being re-derived by repricing past orders against TODAY's
                    menu, which quietly restated old bills every time a price
                    changed.
                  */}
                  <MiniStat
                    label="Total Orders"
                    value={String(selected.orderCount)}
                    background="#f9f9f9"
                    labelColor="rgba(0,0,0,0.45)"
                    valueColor="rgba(0,0,0,0.87)"
                  />
                  <MiniStat
                    label="Lifetime Spend"
                    value={money(selected.lifetimeSpend)}
                    background="#d4e9e2"
                    labelColor="#00754A"
                    valueColor="#00754A"
                  />
                  <MiniStat
                    label="Last Visit"
                    value={selected.last || 'Never'}
                    background="#f9f9f9"
                    labelColor="rgba(0,0,0,0.45)"
                    valueColor="rgba(0,0,0,0.87)"
                    small
                  />
                </div>

                {selected.notes ? (
                  <p
                    style={{
                      margin: '0 20px 12px',
                      padding: '11px 14px',
                      borderRadius: 12,
                      background: '#faf6ee',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#8a6a24',
                      lineHeight: 1.45,
                    }}
                  >
                    {selected.notes}
                  </p>
                ) : null}

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    padding: '0 20px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <h2
                    style={{
                      margin: '4px 0',
                      fontSize: 13,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'rgba(0,0,0,0.45)',
                    }}
                  >
                    Order History
                  </h2>

                  {/*
                    A compact row per bill: number, date, item count and total.
                    The item lines are deliberately not expanded here — the
                    server sends name snapshots taken at sale time, and the
                    place to read a full bill is the order itself.
                  */}
                  {(selected.history ?? []).map((bill) => (
                    <div
                      key={bill.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '11px 14px',
                        border: '1px solid rgba(0,0,0,0.07)',
                        borderRadius: 12,
                        background: '#f9f9f9',
                      }}
                    >
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                          #{bill.orderNo}
                          <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                            {' · '}
                            {new Date(bill.paidAt ?? bill.createdAt).toLocaleDateString()}
                          </span>
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
                          {plural(bill.itemCount, 'item')} · {bill.type}
                        </span>
                      </span>

                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {bill.status === 'paid' ? null : (
                          <StatusBadge
                            bg={bill.status === 'voided' ? '#fdecea' : '#fdf3e0'}
                            fg={bill.status === 'voided' ? '#c82014' : '#8a6a24'}
                            label={bill.status}
                          />
                        )}
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                          {money(bill.total)}
                        </span>
                      </span>
                    </div>
                  ))}

                  {state.custHistoryLoading ? (
                    <p style={emptyHistoryNote}>Loading their orders…</p>
                  ) : null}

                  {/*
                    `history` is undefined until the per-customer endpoint is
                    called, which is NOT the same as the customer having no
                    orders — the old code conflated the two and told the till
                    that every regular was a first-time visitor. The order
                    count above comes from the server and is the honest answer;
                    this panel only speaks when it actually holds the orders.
                  */}
                  {selected.history === undefined ? (
                    state.custHistoryLoading ? null : (
                      <p style={emptyHistoryNote}>
                        {selected.orderCount > 0
                          ? `${plural(selected.orderCount, 'past order')} on record — could not load them.`
                          : 'No orders yet for this customer.'}
                      </p>
                    )
                  ) : selected.history.length === 0 ? (
                    <p style={emptyHistoryNote}>No orders yet for this customer.</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 14,
                  padding: '48px 24px',
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
                  <Icon icon="lucide:user-round-search" size={30} />
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                  Select a customer to view their order history
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'rgba(0,0,0,0.58)',
                    maxWidth: 280,
                    lineHeight: 1.5,
                  }}
                >
                  Pick someone from the list, or add a new customer to start a record.
                </span>
              </div>
            )}
          </section>
        </div>
      </main>

      <CustomerModal />
    </>
  );
}

const emptyHistoryNote = {
  margin: 0,
  padding: '24px 0',
  textAlign: 'center',
  fontSize: 13,
  fontWeight: 500,
  color: 'rgba(0,0,0,0.58)',
} as const;

function MiniStat({
  label,
  value,
  background,
  labelColor,
  valueColor,
  small = false,
}: {
  label: string;
  value: string;
  background: string;
  labelColor: string;
  valueColor: string;
  small?: boolean;
}) {
  return (
    <span
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        background,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        // Grid items are min-width:auto, so a lifetime-spend figure wider than
        // its 96px column pushed straight over the tile beside it.
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: labelColor,
        }}
      >
        {label}
      </span>
      <span
        style={{
          // Scaled to the narrowest tile it has to live in rather than the
          // widest, and allowed to wrap if a figure still outgrows it.
          fontSize: small ? 15 : 19,
          fontWeight: small ? 700 : 800,
          lineHeight: 1.2,
          color: valueColor,
          minWidth: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </span>
    </span>
  );
}

function CustomerModal() {
  const { state, actions } = usePos();
  if (state.modal?.kind !== 'cust') return null;

  const phoneMissing = !!state.custError && !state.custDraft.phone.trim();

  return (
    <ModalOverlay maxWidth={440} scroll>
      <ModalTitle>
        Edit customer
      </ModalTitle>

      <Field label="Name" htmlFor="cname">
        <input
          id="cname"
          type="text"
          placeholder="e.g. Aarav Mehta"
          value={state.custDraft.name}
          onChange={(e) => actions.setCustDraft({ name: e.target.value })}
          style={bareInput}
        />
      </Field>

      <Field
        label="Phone number · required"
        htmlFor="cphone"
        borderColor={phoneMissing ? '#c82014' : '#d6dbde'}
      >
        <input
          id="cphone"
          type="tel"
          placeholder="+91 98200 41122"
          value={state.custDraft.phone}
          onChange={(e) => actions.setCustDraft({ phone: e.target.value })}
          style={bareInput}
        />
      </Field>

      <Field label="Email · optional" htmlFor="cemail">
        <input
          id="cemail"
          type="email"
          placeholder="name@mail.com"
          value={state.custDraft.email}
          onChange={(e) => actions.setCustDraft({ email: e.target.value })}
          style={bareInput}
        />
      </Field>

      <Field label="Notes & preferences · optional" htmlFor="cnotes">
        <textarea
          id="cnotes"
          rows={3}
          placeholder="Allergies, seating preference, usual order"
          value={state.custDraft.notes}
          onChange={(e) => actions.setCustDraft({ notes: e.target.value })}
          style={{ ...bareInput, fontSize: 14, fontWeight: 500, resize: 'none', fontFamily: 'inherit' }}
        />
      </Field>

      {state.custError ? <ErrorLine message={state.custError} /> : null}

      <ModalActions onCancel={actions.closeModal} onSave={actions.saveCustomer} busy={state.custSaving} />
    </ModalOverlay>
  );
}
