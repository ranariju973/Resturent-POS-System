/**
 * The floor view — header, filters and the tile grid.
 *
 * ── Why the tile is a div and not a button ─────────────────────────────────
 * It was a <button>, which meant every admin control had to be absolutely
 * positioned on top of it: a button cannot legally contain another button.
 * That is how the edit and delete icons ended up sitting on the status pill.
 *
 * It is now a div with an explicit button role and key handling, so the edit
 * and delete actions are real buttons in a footer row with their own space.
 * Nothing overlaps, and nothing needs a stopPropagation that will eventually
 * be forgotten.
 */
import type { CSSProperties, KeyboardEvent } from 'react';
import { Icon } from '../icons/Icon';
import type { Table, TableStatus } from '../data/types';
import { usePos } from '../store';
import { PERMISSIONS, can } from '../lib/permissions';
import { duration, minutesSince, money } from '../lib/format';
import { useIsMobile } from '../lib/useViewport';
import { CARD_SHADOW, LoadState, PageHeading, card, primaryPill } from '../components/ui';

/** Occupied tables past this many minutes get a red elapsed figure. */
const LATE_MINUTES = 45;

/** One place for the per-status palette, rather than three nested ternaries. */
const TONE: Record<TableStatus, { border: string; bg: string; fg: string; chip: string; label: string }> = {
  available: { border: '#00754A', bg: '#ffffff', fg: '#00754A', chip: '#d4e9e2', label: 'Available' },
  occupied: { border: '#cba258', bg: '#f8ecd2', fg: '#6b4f12', chip: '#f0dcb0', label: 'Occupied' },
  reserved: { border: '#d6dbde', bg: '#f4f3f0', fg: 'rgba(0,0,0,0.45)', chip: '#edebe9', label: 'Reserved' },
};

const STATUSES: TableStatus[] = ['available', 'occupied', 'reserved'];

export function TableFloor() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();

  // Floor plan is configuration, not operation: a cashier seats and transfers,
  // an admin decides how many tables there are and how big they are.
  const mayEdit = can(state.user?.permissions, PERMISSIONS.TABLE_EDIT);
  const mayCreate = can(state.user?.permissions, PERMISSIONS.TABLE_CREATE);

  // Zones come from the server, plus whatever the loaded tables actually use.
  // A hardcoded list meant a table an admin filed under a new zone was
  // invisible under every filter.
  const zones = ['All', ...new Set([...state.zones, ...state.tables.map((t) => t.zone)])];

  const inZone = state.tables.filter((t) => state.zone === 'All' || t.zone === state.zone);
  const visible = inZone.filter(
    (t) => state.tableStatus === 'all' || t.status === state.tableStatus,
  );
  const countOf = (status: TableStatus) => inZone.filter((t) => t.status === status).length;

  return (
    <main
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 12 : 16,
        padding: isMobile ? 14 : 24,
      }}
    >
      <PageHeading
        wrap
        title="Table Management"
        subtitle={`${inZone.length} tables in ${state.zone === 'All' ? 'all zones' : state.zone}`}
        right={
          mayCreate ? (
            <button
              type="button"
              className="press hv-primary"
              onClick={() => actions.openTableModal(null)}
              style={{ ...primaryPill, padding: '10px 18px' }}
            >
              <Icon icon="lucide:plus" size={15} />
              Add table
            </button>
          ) : undefined
        }
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div
          className={isMobile ? 'scroll-x' : undefined}
          style={{
            display: 'flex',
            flexWrap: isMobile ? 'nowrap' : 'wrap',
            gap: 8,
            maxWidth: '100%',
          }}
        >
          {zones.map((zone) => (
            <Pill
              key={zone}
              label={zone}
              active={zone === state.zone}
              onClick={() => actions.patch({ zone })}
            />
          ))}
        </div>

        {/*
          This replaced a colour legend. A key that only explains what the
          colours mean is read once and then ignored; the same strip carrying
          live counts and doubling as a status filter earns its space every
          shift.
        */}
        <div
          className={isMobile ? 'scroll-x' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 4,
            borderRadius: 50,
            background: '#ffffff',
            boxShadow: CARD_SHADOW,
            maxWidth: '100%',
          }}
        >
          <StatusChip
            label="All"
            count={inZone.length}
            dot={null}
            active={state.tableStatus === 'all'}
            onClick={() => actions.patch({ tableStatus: 'all' })}
          />
          {STATUSES.map((status) => (
            <StatusChip
              key={status}
              label={TONE[status].label}
              count={countOf(status)}
              dot={TONE[status].border}
              active={state.tableStatus === status}
              onClick={() => actions.patch({ tableStatus: status })}
            />
          ))}
        </div>
      </div>

      <div style={{ ...card, flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? 10 : 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 145 : 200}px, 1fr))`,
            gap: isMobile ? 10 : 16,
            alignContent: 'start',
          }}
        >
          {visible.map((table) => (
            <TableTile key={table.id} table={table} mayEdit={mayEdit} />
          ))}
        </div>

        <LoadState
          loading={state.tablesLoading}
          error={state.tablesError}
          empty={!state.tablesLoading && !state.tablesError && visible.length === 0}
          emptyMessage={
            inZone.length === 0
              ? 'No tables in this zone yet.'
              : `No ${state.tableStatus} tables right now.`
          }
          onRetry={() => void actions.loadTables()}
        />
      </div>
    </main>
  );
}

function Pill({
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
        padding: '8px 16px',
        borderRadius: 50,
        border: `1px solid ${active ? '#00754A' : '#d6dbde'}`,
        background: active ? '#00754A' : '#ffffff',
        color: active ? '#ffffff' : 'rgba(0,0,0,0.58)',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function StatusChip({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string;
  count: number;
  dot: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 13px',
        borderRadius: 50,
        border: 0,
        background: active ? '#1E3932' : 'transparent',
        color: active ? '#ffffff' : 'rgba(0,0,0,0.58)',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {dot ? (
        <span
          aria-hidden
          style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0 }}
        />
      ) : null}
      {label}
      <span style={{ opacity: active ? 0.75 : 0.55 }}>{count}</span>
    </button>
  );
}

function TableTile({ table, mayEdit }: { table: Table; mayEdit: boolean }) {
  const { actions } = usePos();
  const isMobile = useIsMobile();
  const tone = TONE[table.status];
  const occupied = table.status === 'occupied';
  const mins = minutesSince(table.startedAt);
  const late = mins >= LATE_MINUTES;

  const open = () => actions.openTable(table);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // A div with a button role has to implement what a button gave for free.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        border: `2px solid ${tone.border}`,
        background: tone.bg,
        overflow: 'hidden',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${table.name}, ${tone.label}, ${table.seats} seats`}
        className="press hv-lift"
        onClick={open}
        onKeyDown={onKey}
        style={{
          flex: 1,
          minHeight: 116,
          padding: isMobile ? 11 : 14,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: isMobile ? 18 : 22,
              fontWeight: 800,
              lineHeight: 1.1,
              color: tone.fg,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
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
              background: tone.chip,
              color: tone.fg,
              whiteSpace: 'nowrap',
            }}
          >
            {tone.label}
          </span>
        </div>

        {/*
          Seats, zone and the merge state on one muted line. The merged flag
          used to be a badge hanging off the top edge at a negative offset,
          which clipped inside the scrolling grid.
        */}
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
          <Icon icon="lucide:users" size={13} />
          {table.seats} seats
          <span style={{ opacity: 0.5 }}>·</span>
          {table.zone}
          {table.merge ? (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <Icon icon="lucide:link" size={12} />
              Merged
            </>
          ) : null}
        </span>

        {occupied ? (
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'flex-end',
              justifyContent: 'space-between',
              gap: isMobile ? 6 : 8,
              minWidth: 0,
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={microLabel}>Elapsed</span>
              <span
                style={{
                  fontSize: isMobile ? 17 : 24,
                  fontWeight: 800,
                  lineHeight: 1.1,
                  color: late ? '#c82014' : '#6b4f12',
                }}
              >
                {duration(mins)}
              </span>
            </span>
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                alignItems: isMobile ? 'flex-start' : 'flex-end',
              }}
            >
              <span style={microLabel}>Running</span>
              <span
                style={{
                  fontSize: isMobile ? 14 : 15,
                  fontWeight: 700,
                  color: '#6b4f12',
                  overflowWrap: 'anywhere',
                }}
              >
                {money(table.orderTotal)}
              </span>
            </span>
          </div>
        ) : (
          <span
            style={{
              marginTop: 'auto',
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(0,0,0,0.45)',
            }}
          >
            {table.status === 'reserved' ? 'Held — tap to seat' : 'Tap to start an order'}
          </span>
        )}
      </div>

      {/*
        Admin actions get their own strip below a hairline. Previously these
        were absolutely positioned at the top-right — directly on top of the
        status pill.
      */}
      {mayEdit ? (
        <div
          style={{
            display: 'flex',
            borderTop: `1px solid ${occupied ? 'rgba(107,79,18,0.18)' : 'rgba(0,0,0,0.08)'}`,
            background: 'rgba(255,255,255,0.55)',
          }}
        >
          <TileAction
            icon="lucide:pencil"
            label="Edit"
            onClick={() => actions.openTableModal(table)}
          />
          <span style={{ width: 1, background: 'rgba(0,0,0,0.08)' }} />
          <TileAction
            icon="lucide:trash-2"
            label="Delete"
            danger
            onClick={() => {
              const ok = window.confirm(
                `Remove ${table.name}? Past orders keep resolving — the record is kept, not erased.`,
              );
              if (ok) void actions.deleteTable(table.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function TileAction({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '8px 0',
        border: 0,
        background: 'transparent',
        color: danger ? '#c82014' : 'rgba(0,0,0,0.58)',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      <Icon icon={icon} size={13} />
      {label}
    </button>
  );
}

const microLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#8a6a24',
};
