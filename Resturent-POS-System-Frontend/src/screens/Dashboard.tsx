import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import { CONFIG, usePos } from '../store';
import { clockTime, money, plural } from '../lib/format';
import { CARD_SHADOW, LoadState, StatusBadge, card, tableHeaderCell } from '../components/ui';
import { PERMISSIONS, can } from '../lib/permissions';
import { OrderDetail } from '../components/OrderDetail';

/** Order status colours. Voided is muted, not alarming — it is a normal outcome. */
const ORDER_BADGE: Record<'open' | 'paid' | 'voided', { bg: string; fg: string; label: string }> = {
  open: { bg: '#f8ecd2', fg: '#6b4f12', label: 'Open' },
  paid: { bg: '#d4e9e2', fg: '#00754A', label: 'Paid' },
  voided: { bg: '#f4f3f0', fg: 'rgba(0,0,0,0.45)', label: 'Voided' },
};

const ROW_GRID: CSSProperties = {
  minWidth: 700,
  display: 'grid',
  gridTemplateColumns: '84px minmax(130px, 1.4fr) 96px 100px 116px 92px',
  gap: 12,
};

export function Dashboard() {
  const { state, actions } = usePos();
  const dash = state.dash;

  useEffect(() => {
    void actions.loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every figure here is the server's. The previous version summed open table
  // bills, which counted unpaid tabs as takings and ignored anything already
  // settled — it agreed with the till only by accident.
  const sales = dash?.todaySales ?? 0;
  const orders = dash?.todayOrders ?? 0;
  const pending = dash?.pendingOrders ?? 0;
  const completed = dash?.completedOrders ?? 0;
  const recent = dash?.recentOrders ?? [];
  const mayDelete = can(state.user?.permissions, PERMISSIONS.ORDER_DELETE);

  return (
    <main
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#006241', lineHeight: 1.2 }}>
          Today at {CONFIG.restaurantName}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
          Live snapshot of the current service
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))',
          gap: 16,
        }}
      >
        <StatCard
          icon="lucide:banknote"
          iconBg="#d4e9e2"
          iconColor="#00754A"
          label="Today's Sales"
          value={money(sales)}
          valueColor="#00754A"
        />
        <StatCard
          icon="lucide:receipt"
          iconBg="#f2f0eb"
          iconColor="#1E3932"
          label="Today's Orders"
          value={String(orders)}
        />

        <button
          type="button"
          className="press hv-green-border"
          onClick={actions.goPending}
          style={{
            textAlign: 'left',
            background: '#ffffff',
            border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 12,
            boxShadow: CARD_SHADOW,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ ...iconTile, background: '#f8ecd2', color: '#6b4f12' }}>
              <Icon icon="lucide:clock" size={21} />
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                color: '#00754A',
              }}
            >
              Kitchen
              <Icon icon="lucide:arrow-up-right" size={14} />
            </span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={statLabel}>Pending Orders</span>
            <span style={{ ...statValue, color: 'rgba(0,0,0,0.87)' }}>{pending}</span>
          </span>
        </button>

        <StatCard
          icon="lucide:check-check"
          iconBg="#f2f0eb"
          iconColor="#1E3932"
          label="Completed Orders"
          value={String(completed)}
        />
      </div>

      <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2
          style={{
            margin: '0 0 12px',
            fontSize: 17,
            fontWeight: 700,
            color: 'rgba(0,0,0,0.87)',
          }}
        >
          Recent Orders
        </h2>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...ROW_GRID, padding: '0 12px 10px', borderBottom: '1px solid #edebe9' }}>
            <span style={tableHeaderCell}>Order</span>
            <span style={tableHeaderCell}>Type</span>
            <span style={tableHeaderCell}>Items</span>
            <span style={tableHeaderCell}>Total</span>
            <span style={tableHeaderCell}>Status</span>
            <span style={{ ...tableHeaderCell, textAlign: 'right' }}>Time</span>
          </div>

          {recent.map((order) => (
            <button
              key={order.id}
              type="button"
              className="press hv-lift"
              onClick={() => void actions.viewOrderDetail(order.id)}
              style={{
                ...ROW_GRID,
                width: '100%',
                textAlign: 'left',
                alignItems: 'center',
                padding: '13px 12px',
                border: 0,
                borderBottom: '1px solid #f4f3f0',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                #{order.orderNo}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'rgba(0,0,0,0.87)',
                  textTransform: 'capitalize',
                }}
              >
                {order.type}
              </span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
                {plural(order.itemCount, 'item')}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  // A voided total is struck through rather than hidden: the
                  // amount is still a fact about what happened.
                  color: order.status === 'voided' ? 'rgba(0,0,0,0.32)' : '#00754A',
                  textDecoration: order.status === 'voided' ? 'line-through' : 'none',
                }}
              >
                {money(order.total)}
              </span>
              <StatusBadge {...ORDER_BADGE[order.status]} />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'rgba(0,0,0,0.45)',
                  textAlign: 'right',
                }}
              >
                {clockTime(Date.parse(order.createdAt))}
              </span>
            </button>
          ))}

          <LoadState
            loading={state.dashLoading && !dash}
            error={state.dashError}
            empty={!state.dashLoading && !state.dashError && recent.length === 0}
            emptyMessage="No orders yet today."
            onRetry={() => void actions.loadDashboard()}
          />
        </div>
      </section>

      <OrderDetail mayDelete={mayDelete} />
    </main>
  );
}

function StatCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  valueColor = 'rgba(0,0,0,0.87)',
}: {
  icon: string;
  iconBg: string;
  iconColor: string;
  label: string;
  value: ReactNode;
  valueColor?: string;
}) {
  return (
    <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <span style={{ ...iconTile, background: iconBg, color: iconColor }}>
        <Icon icon={icon} size={21} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={statLabel}>{label}</span>
        <span style={{ ...statValue, color: valueColor }}>{value}</span>
      </span>
    </div>
  );
}

const iconTile: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const statLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'rgba(0,0,0,0.45)',
};

const statValue: CSSProperties = { fontSize: 38, fontWeight: 800, lineHeight: 1 };
