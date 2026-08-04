import type { CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { ZONES } from '../data/seed';
import type { Table } from '../data/types';
import { usePos } from '../store';
import { duration, minutesSince, money } from '../lib/format';
import { resolveOrder } from '../lib/orders';
import { CARD_SHADOW, FilterPill, PageHeading, Toggle, card, outlinePill } from '../components/ui';

/** Occupied tables past this many minutes get a red elapsed figure. */
const LATE_MINUTES = 45;

export function TableManagement() {
  const { state, actions } = usePos();
  const inZone = state.tables.filter((t) => state.zone === 'All' || t.zone === state.zone);
  const occupied = inZone.filter((t) => t.status === 'occupied').length;

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
          wrap
          title="Table Management"
          subtitle={`${occupied} of ${inZone.length} tables occupied`}
          right={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '9px 16px',
                borderRadius: 50,
                background: '#ffffff',
                boxShadow: CARD_SHADOW,
              }}
            >
              <LegendKey label="Available" bg="#ffffff" border="#00754A" />
              <LegendKey label="Occupied" bg="#f0dcb0" border="#cba258" />
              <LegendKey label="Reserved" bg="#f4f3f0" border="#d6dbde" />
            </div>
          }
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ZONES.map((zone) => (
            <FilterPill
              key={zone}
              label={zone}
              active={zone === state.zone}
              onClick={() => actions.patch({ zone })}
            />
          ))}
        </div>

        <div
          style={{
            ...card,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 16,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
              gap: 16,
              alignContent: 'start',
            }}
          >
            {inZone.map((table) => (
              <TableTile key={table.id} table={table} />
            ))}
          </div>
        </div>
      </main>

      {state.selTable ? <TablePanel /> : null}
    </>
  );
}

function LegendKey({ label, bg, border }: { label: string; bg: string; border: string }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 12,
        fontWeight: 600,
        color: 'rgba(0,0,0,0.58)',
      }}
    >
      <span
        style={{ width: 12, height: 12, borderRadius: 4, background: bg, border: `2px solid ${border}` }}
      />
      {label}
    </span>
  );
}

function TableTile({ table }: { table: Table }) {
  const { state, actions } = usePos();
  const occupied = table.status === 'occupied';
  const reserved = table.status === 'reserved';
  const mins = minutesSince(table.startedAt);
  const late = mins >= LATE_MINUTES;
  const total = resolveOrder(table.order, state.items).reduce((a, l) => a + l.price * l.qty, 0);

  return (
    <button
      type="button"
      className="press hv-lift"
      onClick={() => actions.openTable(table)}
      style={{
        position: 'relative',
        textAlign: 'left',
        minHeight: 138,
        padding: 14,
        borderRadius: 12,
        border: `2px solid ${occupied ? '#cba258' : reserved ? '#d6dbde' : '#00754A'}`,
        background: occupied ? '#f8ecd2' : reserved ? '#f4f3f0' : '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 800,
            lineHeight: 1,
            color: occupied ? '#6b4f12' : reserved ? 'rgba(0,0,0,0.45)' : '#00754A',
          }}
        >
          {table.name}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding: '3px 10px',
            borderRadius: 50,
            background: occupied ? '#f0dcb0' : reserved ? '#edebe9' : '#d4e9e2',
            color: occupied ? '#6b4f12' : reserved ? 'rgba(0,0,0,0.45)' : '#00754A',
          }}
        >
          {occupied ? 'Occupied' : reserved ? 'Reserved' : 'Available'}
        </span>
      </span>

      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: occupied ? '#8a6a24' : 'rgba(0,0,0,0.45)',
        }}
      >
        <Icon icon="lucide:users" size={14} />
        {table.seats} seats
      </span>

      {occupied ? (
        <span
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#8a6a24',
              }}
            >
              Elapsed
            </span>
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                lineHeight: 1,
                color: late ? '#c82014' : '#6b4f12',
              }}
            >
              {duration(mins)}
            </span>
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#6b4f12' }}>{money(total)}</span>
        </span>
      ) : (
        <span
          style={{
            marginTop: 'auto',
            fontSize: 12,
            fontWeight: 600,
            color: 'rgba(0,0,0,0.45)',
          }}
        >
          Tap to start an order
        </span>
      )}

      {table.merge ? (
        <span
          style={{
            position: 'absolute',
            top: -9,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            borderRadius: 50,
            background: '#1E3932',
            color: '#ffffff',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          <Icon icon="lucide:link" size={11} />
          Merged
        </span>
      ) : null}
    </button>
  );
}

function TablePanel() {
  const { state, actions } = usePos();
  const table = state.tables.find((t) => t.id === state.selTable);
  if (!table) return null;

  const group = table.merge ? state.tables.filter((t) => t.merge === table.merge) : [table];
  const rows = group.flatMap((g) =>
    resolveOrder(g.order, state.items).map((l) => ({ ...l, from: g.name })),
  );
  const total = rows.reduce((a, l) => a + l.price * l.qty, 0);
  const mins = minutesSince(table.startedAt);

  const available = state.tables.filter((t) => t.status === 'available');
  const mergeCandidates = state.tables.filter(
    (t) => t.status === 'occupied' && t.id !== table.id && !(table.merge && t.merge === table.merge),
  );

  const billCount = state.splitCount;
  const billTotals = Array.from({ length: billCount }, () => 0);
  rows.forEach((l, i) => {
    billTotals[state.splitMap[i] ?? 0] += l.price * l.qty;
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 45,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '100%',
          height: '100%',
          background: '#ffffff',
          boxShadow: '0 0 6px rgba(0,0,0,0.24), 0 8px 12px rgba(0,0,0,0.14)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'riseIn 0.2s ease-out',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: 20,
            borderBottom: '1px solid #edebe9',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: 'rgba(0,0,0,0.87)',
                lineHeight: 1.1,
              }}
            >
              Table {table.name}
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
              {table.seats} seats · {table.zone}
            </span>
            {table.merge ? (
              <span
                style={{
                  marginTop: 4,
                  alignSelf: 'flex-start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 12px',
                  borderRadius: 50,
                  background: '#d4e9e2',
                  color: '#1E3932',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <Icon icon="lucide:link" size={12} />
                Shared bill with{' '}
                {group
                  .filter((g) => g.id !== table.id)
                  .map((g) => g.name)
                  .join(', ')}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="press hv-green"
            title="Close"
            onClick={actions.closePanel}
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '1px solid #d6dbde',
              background: '#ffffff',
              color: 'rgba(0,0,0,0.58)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon icon="lucide:x" size={17} />
          </button>
        </div>

        {state.panel === 'summary' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {table.status === 'occupied' ? (
              <>
                <div style={{ flexShrink: 0, padding: '16px 20px', display: 'flex', gap: 12 }}>
                  <PanelStat
                    label="Elapsed"
                    value={duration(mins) || '—'}
                    background="#f8ecd2"
                    labelColor="#8a6a24"
                    valueColor={mins >= LATE_MINUTES ? '#c82014' : '#6b4f12'}
                  />
                  <PanelStat
                    label="Running total"
                    value={money(total)}
                    background="#f9f9f9"
                    labelColor="rgba(0,0,0,0.45)"
                    valueColor="#00754A"
                  />
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    padding: '0 20px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {rows.map((line, i) => (
                    <div key={`${line.id}-${line.from}-${i}`} style={panelRow}>
                      <span
                        style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
                      >
                        <span
                          style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}
                        >
                          {line.name}
                        </span>
                        <span
                          style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}
                        >
                          × {line.qty} · from {line.from}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: '#00754A',
                          flexShrink: 0,
                        }}
                      >
                        {money(line.price * line.qty)}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    flexShrink: 0,
                    borderTop: '1px solid #edebe9',
                    padding: '16px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    className="press hv-green"
                    onClick={() => actions.patch({ panel: 'transfer' })}
                    style={{ ...outlinePill, width: '100%' }}
                  >
                    <Icon icon="lucide:move-right" />
                    Transfer Table
                  </button>
                  <button
                    type="button"
                    className="press hv-green"
                    onClick={() => actions.patch({ panel: 'merge' })}
                    style={{ ...outlinePill, width: '100%' }}
                  >
                    <Icon icon="lucide:link" />
                    Merge Table
                  </button>
                  <button
                    type="button"
                    className="press hv-primary"
                    onClick={() => actions.patch({ panel: 'split', splitMap: {} })}
                    style={{
                      ...outlinePill,
                      width: '100%',
                      padding: '13px 20px',
                      border: '1px solid #00754A',
                      background: '#00754A',
                      color: '#ffffff',
                    }}
                  >
                    <Icon icon="lucide:split" />
                    Split Bill
                  </button>
                </div>
              </>
            ) : null}

            {table.status === 'reserved' ? (
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
                    width: 68,
                    height: 68,
                    borderRadius: '50%',
                    background: '#f2f0eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(0,0,0,0.45)',
                  }}
                >
                  <Icon icon="lucide:calendar-check" size={28} />
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                  Reserved
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'rgba(0,0,0,0.58)',
                    maxWidth: 240,
                    lineHeight: 1.5,
                  }}
                >
                  Held for an upcoming booking. Reservations aren't wired up yet — you can still
                  seat the party now.
                </span>
                <button
                  type="button"
                  className="press hv-primary"
                  onClick={() => actions.startOrderAt(table)}
                  style={{
                    marginTop: 4,
                    padding: '12px 24px',
                    borderRadius: 50,
                    border: '1px solid #00754A',
                    background: '#00754A',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  Seat &amp; start order
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.panel === 'transfer' ? (
          <PickerPane
            hint="Pick an available table to move this order to."
            empty={available.length === 0 ? 'No free tables right now.' : null}
          >
            {available.map((t) => (
              <button
                key={t.id}
                type="button"
                className="press hv-green-fill"
                onClick={() => actions.transferTable(t.id)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 12,
                  border: '2px solid #00754A',
                  background: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 19, fontWeight: 800, color: '#00754A', lineHeight: 1 }}>
                  {t.name}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                  {t.seats} seats · {t.zone}
                </span>
              </button>
            ))}
          </PickerPane>
        ) : null}

        {state.panel === 'merge' ? (
          <PickerPane
            hint="Pick another occupied table to combine into one shared bill."
            empty={mergeCandidates.length === 0 ? 'No other occupied tables to merge with.' : null}
          >
            {mergeCandidates.map((t) => {
              const value = resolveOrder(t.order, state.items).reduce(
                (a, l) => a + l.price * l.qty,
                0,
              );
              return (
                <button
                  key={t.id}
                  type="button"
                  className="press hv-gold"
                  onClick={() => actions.mergeTable(t.id)}
                  style={{
                    textAlign: 'left',
                    padding: 14,
                    borderRadius: 12,
                    border: '2px solid #cba258',
                    background: '#f8ecd2',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 19, fontWeight: 800, color: '#6b4f12', lineHeight: 1 }}>
                    {t.name}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#8a6a24' }}>
                    {t.seats} seats · {money(value)}
                  </span>
                </button>
              );
            })}
          </PickerPane>
        ) : null}

        {state.panel === 'split' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                flexShrink: 0,
                padding: '16px 20px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="press"
                    onClick={() => actions.patch({ splitCount: n, splitMap: {} })}
                    style={{
                      flex: 1,
                      padding: '9px 14px',
                      borderRadius: 50,
                      fontSize: 13,
                      fontWeight: 700,
                      background: n === billCount ? '#00754A' : '#ffffff',
                      color: n === billCount ? '#ffffff' : 'rgba(0,0,0,0.58)',
                      border: `1px solid ${n === billCount ? '#00754A' : '#d6dbde'}`,
                    }}
                  >
                    {n} bills
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="press"
                onClick={() => actions.patch({ evenSplit: !state.evenSplit })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 16px 9px 9px',
                  borderRadius: 50,
                  border: '1px solid #d6dbde',
                  background: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.87)',
                }}
              >
                <Toggle on={state.evenSplit} />
                {state.evenSplit ? `Even ${billCount}-way split` : 'Assign items manually'}
              </button>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '0 20px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {!state.evenSplit &&
                rows.map((line, i) => (
                  <div key={`${line.id}-${line.from}-${i}`} style={panelRow}>
                    <span
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                        {line.name}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>
                        × {line.qty} · {money(line.price * line.qty)}
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                      {Array.from({ length: billCount }, (_, bill) => {
                        const on = (state.splitMap[i] ?? 0) === bill;
                        return (
                          <button
                            key={bill}
                            type="button"
                            className="press"
                            title={`Assign to bill ${bill + 1}`}
                            onClick={() => actions.assignSplit(i, bill)}
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: '50%',
                              fontSize: 13,
                              fontWeight: 700,
                              background: on ? '#00754A' : '#ffffff',
                              color: on ? '#ffffff' : 'rgba(0,0,0,0.45)',
                              border: `1px solid ${on ? '#00754A' : '#d6dbde'}`,
                            }}
                          >
                            {bill + 1}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                ))}
            </div>

            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid #edebe9',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {Array.from({ length: billCount }, (_, bill) => (
                  <div
                    key={bill}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontSize: 14,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
                      Bill {bill + 1}
                    </span>
                    <span style={{ fontWeight: 800, color: '#00754A', fontSize: 17 }}>
                      {money(state.evenSplit ? total / billCount : billTotals[bill])}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="press hv-neutral"
                  onClick={() => actions.patch({ panel: 'summary' })}
                  style={{ ...outlinePill, flex: 1 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="press hv-primary"
                  onClick={actions.closePanel}
                  style={{
                    ...outlinePill,
                    flex: 1,
                    border: '1px solid #00754A',
                    background: '#00754A',
                    color: '#ffffff',
                  }}
                >
                  Confirm split
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PanelStat({
  label,
  value,
  background,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  background: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <span
      style={{
        flex: 1,
        padding: '12px 14px',
        borderRadius: 12,
        background,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: labelColor,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: valueColor }}>
        {value}
      </span>
    </span>
  );
}

function PickerPane({
  hint,
  empty,
  children,
}: {
  hint: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  const { actions } = usePos();
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <p
        style={{
          margin: 0,
          padding: '16px 20px 10px',
          fontSize: 13,
          fontWeight: 600,
          color: 'rgba(0,0,0,0.58)',
        }}
      >
        {hint}
      </p>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '0 20px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
          alignContent: 'start',
        }}
      >
        {children}
        {empty ? (
          <p
            style={{
              gridColumn: '1 / -1',
              margin: 0,
              padding: '24px 0',
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 500,
              color: 'rgba(0,0,0,0.58)',
            }}
          >
            {empty}
          </p>
        ) : null}
      </div>
      <div style={{ flexShrink: 0, borderTop: '1px solid #edebe9', padding: '16px 20px' }}>
        <button
          type="button"
          className="press hv-neutral"
          onClick={() => actions.patch({ panel: 'summary' })}
          style={{ ...outlinePill, width: '100%' }}
        >
          Back
        </button>
      </div>
    </div>
  );
}

const panelRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '11px 14px',
  borderRadius: 12,
  background: '#f9f9f9',
  border: '1px solid rgba(0,0,0,0.07)',
};
