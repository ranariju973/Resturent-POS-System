import { Icon } from '../icons/Icon';
import { KDS_COLS } from '../data/seed';
import type { Ticket } from '../data/types';
import { usePos } from '../store';
import { duration, minutesSince } from '../lib/format';
import { CARD_SHADOW, FilterPill, PageHeading } from '../components/ui';

const TYPES = ['All', 'Dine-in', 'Takeaway', 'Delivery'];

/** Age thresholds that drive the card accent — the board's whole job. */
const AGEING_AT = 5;
const OVERDUE_AT = 10;

const tone = (ticket: Ticket, age: number) => {
  if (ticket.status === 'served') {
    return {
      accent: '#d6dbde',
      time: 'rgba(0,0,0,0.45)',
      chip: '#f4f3f0',
      chipFg: 'rgba(0,0,0,0.45)',
      label: 'Done',
    };
  }
  if (age > OVERDUE_AT) {
    return {
      accent: '#c82014',
      time: '#c82014',
      chip: 'rgba(200,32,20,0.10)',
      chipFg: '#c82014',
      label: 'Overdue',
    };
  }
  if (age >= AGEING_AT) {
    return { accent: '#cba258', time: '#8a6a24', chip: '#f8ecd2', chipFg: '#6b4f12', label: 'Ageing' };
  }
  return { accent: '#00754A', time: '#00754A', chip: '#d4e9e2', chipFg: '#00754A', label: 'On time' };
};

export function Kitchen() {
  const { state, actions } = usePos();

  const late = state.tickets.filter(
    (t) => t.status !== 'served' && minutesSince(t.placedAt) > OVERDUE_AT,
  ).length;

  return (
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
        title="Kitchen Management"
        subtitle="Status board — tickets still print to the kitchen"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: late ? '#c82014' : '#00754A' }}>
              {late === 0
                ? 'All orders on time'
                : `${late} order${late === 1 ? '' : 's'} over 10 min`}
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '9px 16px',
                borderRadius: 50,
                background: '#ffffff',
                boxShadow: CARD_SHADOW,
              }}
            >
              <LegendSwatch color="#00754A" label="< 5 min" />
              <LegendSwatch color="#cba258" label="5–10 min" />
              <LegendSwatch color="#c82014" label="10 min+" />
            </span>
          </div>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {TYPES.map((type) => (
          <FilterPill
            key={type}
            label={type}
            active={type === state.kdsType}
            onClick={() => actions.patch({ kdsType: type })}
          />
        ))}
        {state.kdsFocus ? (
          <button
            type="button"
            className="press"
            onClick={() => actions.patch({ kdsFocus: null })}
            style={{
              marginLeft: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 16px',
              borderRadius: 50,
              border: '1px solid #00754A',
              background: '#d4e9e2',
              color: '#1E3932',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Focused on {KDS_COLS.find((c) => c.id === state.kdsFocus)?.label}
            <Icon icon="lucide:x" size={14} color="#00754A" />
          </button>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))',
          gap: 16,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        {KDS_COLS.map((col) => {
          const cards = state.tickets
            .filter((t) => t.status === col.id)
            .filter((t) => state.kdsType === 'All' || t.type === state.kdsType.toLowerCase())
            .sort((a, b) => a.placedAt - b.placedAt);
          const focused = state.kdsFocus === col.id;
          const dimmed = !!state.kdsFocus && !focused;

          return (
            <section
              key={col.id}
              style={{
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                background: '#ffffff',
                borderRadius: 12,
                padding: 14,
                boxShadow: CARD_SHADOW,
                border: `2px solid ${focused ? '#00754A' : 'rgba(0,0,0,0)'}`,
                opacity: dimmed ? 0.45 : 1,
                transition: 'opacity 0.2s ease',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 7,
                  paddingBottom: 10,
                  borderBottom: '1px solid #edebe9',
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: focused ? '#00754A' : 'rgba(0,0,0,0.87)',
                  }}
                >
                  {col.label}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.45)' }}>
                  ({cards.length})
                </span>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  paddingRight: 2,
                }}
              >
                {cards.map((ticket) => {
                  const age = minutesSince(ticket.placedAt);
                  const t = tone(ticket, age);
                  const next = KDS_COLS.find((c) => c.id === ticket.status)?.next;
                  const nextCol = KDS_COLS.find((c) => c.id === next);

                  return (
                    <div
                      key={ticket.id}
                      style={{
                        borderRadius: 12,
                        border: '1px solid rgba(0,0,0,0.07)',
                        borderLeft: `5px solid ${t.accent}`,
                        background: '#ffffff',
                        boxShadow: CARD_SHADOW,
                        padding: 13,
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
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 800,
                              color: 'rgba(0,0,0,0.87)',
                              lineHeight: 1.1,
                            }}
                          >
                            Order #{ticket.no}
                          </span>
                          <span
                            style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}
                          >
                            {ticket.source}
                          </span>
                        </span>
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 9,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            padding: '3px 9px',
                            borderRadius: 50,
                            background: t.chip,
                            color: t.chipFg,
                          }}
                        >
                          {t.label}
                        </span>
                      </div>

                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                        <span
                          style={{
                            fontSize: 32,
                            fontWeight: 800,
                            lineHeight: 1,
                            color: t.time,
                          }}
                        >
                          {duration(age)}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: 'rgba(0,0,0,0.45)',
                          }}
                        >
                          since placed
                        </span>
                      </span>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: '#f9f9f9',
                        }}
                      >
                        {ticket.order.map(([id, qty]) => {
                          const item = state.items.find((x) => x.id === id);
                          return (
                            <span
                              key={id}
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: 10,
                                fontSize: 13,
                              }}
                            >
                              <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                                {item ? item.name : id}
                              </span>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: 'rgba(0,0,0,0.45)',
                                  flexShrink: 0,
                                }}
                              >
                                × {qty}
                              </span>
                            </span>
                          );
                        })}
                      </div>

                      {nextCol ? (
                        <button
                          type="button"
                          className="press hv-primary"
                          onClick={() => actions.advanceTicket(ticket.id)}
                          style={{
                            width: '100%',
                            padding: '11px 16px',
                            borderRadius: 50,
                            border: '1px solid #00754A',
                            background: '#00754A',
                            color: '#ffffff',
                            fontSize: 13,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 7,
                          }}
                        >
                          <Icon icon={nextCol.icon} size={15} />
                          {KDS_COLS.find((c) => c.id === ticket.status)?.cta}
                        </button>
                      ) : null}
                    </div>
                  );
                })}

                {cards.length === 0 ? (
                  <p
                    style={{
                      margin: 'auto 0',
                      padding: '32px 12px',
                      textAlign: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'rgba(0,0,0,0.32)',
                    }}
                  >
                    No orders
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
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
      <span style={{ width: 12, height: 12, borderRadius: 4, background: color }} />
      {label}
    </span>
  );
}
