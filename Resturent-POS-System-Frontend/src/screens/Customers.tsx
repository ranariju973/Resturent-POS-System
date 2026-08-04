import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { money, plural } from '../lib/format';
import { STATUS_BADGE, orderCount, orderValue, resolveOrder } from '../lib/orders';
import {
  ErrorLine,
  Field,
  IconButton,
  ModalActions,
  ModalOverlay,
  ModalTitle,
  PageHeading,
  SearchInput,
  bareInput,
  card,
  primaryPill,
} from '../components/ui';

export function Customers() {
  const { state, actions } = usePos();

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
          padding: 24,
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

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 24, overflowX: 'auto' }}>
          <section
            style={{
              ...card,
              width: 320,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 16,
            }}
          >
            <button
              type="button"
              className="press hv-primary"
              onClick={() => actions.openCustModal(null)}
              style={{
                ...primaryPill,
                width: '100%',
                justifyContent: 'center',
                padding: '11px 18px',
              }}
            >
              <Icon icon="lucide:plus" />
              Add Customer
            </button>

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
                    onClick={() => actions.patch({ selCust: customer.id, openOrder: null })}
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
                      <span>Last visit {customer.last}</span>
                      <span>{plural(customer.history.length, 'order')}</span>
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
              minWidth: 340,
              display: 'flex',
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
                      <span
                        style={{
                          fontSize: 21,
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
                    gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
                    gap: 12,
                  }}
                >
                  <MiniStat
                    label="Total Orders"
                    value={String(selected.history.length)}
                    background="#f9f9f9"
                    labelColor="rgba(0,0,0,0.45)"
                    valueColor="rgba(0,0,0,0.87)"
                  />
                  <MiniStat
                    label="Lifetime Spend"
                    value={money(
                      selected.history.reduce(
                        (sum, o) => sum + orderValue(o.order, state.items),
                        0,
                      ),
                    )}
                    background="#d4e9e2"
                    labelColor="#00754A"
                    valueColor="#00754A"
                  />
                  <MiniStat
                    label="Last Visit"
                    value={selected.last}
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

                  {selected.history.map((order, index) => {
                    const open = state.openOrder === index;
                    const badge = STATUS_BADGE[order.status];
                    return (
                      <div
                        key={`${order.date}-${index}`}
                        style={{
                          border: '1px solid rgba(0,0,0,0.07)',
                          borderRadius: 12,
                          background: '#f9f9f9',
                          overflow: 'hidden',
                        }}
                      >
                        <button
                          type="button"
                          className="press"
                          onClick={() => actions.patch({ openOrder: open ? null : index })}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '13px 14px',
                            border: 0,
                            background: 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                            }}
                          >
                            <span
                              style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}
                            >
                              {order.date}
                            </span>
                            <span
                              style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}
                            >
                              {plural(orderCount(order.order), 'item')}
                            </span>
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '4px 12px',
                              borderRadius: 50,
                              flexShrink: 0,
                              background: badge.bg,
                              color: badge.fg,
                            }}
                          >
                            {badge.label}
                          </span>
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: '#00754A',
                              flexShrink: 0,
                            }}
                          >
                            {money(orderValue(order.order, state.items))}
                          </span>
                          <Icon
                            icon={open ? 'lucide:chevron-up' : 'lucide:chevron-down'}
                            color="rgba(0,0,0,0.45)"
                          />
                        </button>

                        {open ? (
                          <div
                            style={{
                              padding: '0 14px 13px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            {resolveOrder(order.order, state.items).map((line) => (
                              <span
                                key={line.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'baseline',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                  padding: '9px 12px',
                                  borderRadius: 10,
                                  background: '#ffffff',
                                  fontSize: 13,
                                }}
                              >
                                <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                                  {line.name}
                                </span>
                                <span
                                  style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 12,
                                    flexShrink: 0,
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
                                    × {line.qty}
                                  </span>
                                  <span style={{ fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                                    {money(line.price * line.qty)}
                                  </span>
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {selected.history.length === 0 ? (
                    <p
                      style={{
                        margin: 0,
                        padding: '24px 0',
                        textAlign: 'center',
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'rgba(0,0,0,0.58)',
                      }}
                    >
                      No orders yet for this customer.
                    </p>
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
        padding: '14px 16px',
        borderRadius: 12,
        background,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
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
          fontSize: small ? 17 : 24,
          fontWeight: small ? 700 : 800,
          lineHeight: small ? 1.2 : 1,
          color: valueColor,
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
        {state.modal.mode === 'edit' ? 'Edit customer' : 'Add customer'}
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

      <ModalActions onCancel={actions.closeModal} onSave={actions.saveCustomer} />
    </ModalOverlay>
  );
}
