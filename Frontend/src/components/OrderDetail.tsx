/**
 * Full order detail, with the admin-only permanent delete.
 *
 * The order is fetched by id when a row is clicked rather than reused from the
 * dashboard summary, so what is shown here is the bill as it stands now — not
 * as it stood whenever the dashboard last loaded.
 */
import { usePos } from '../store';
import { CURRENCY, money, plural } from '../lib/format';
import { Icon } from '../icons/Icon';
import { ModalOverlay, ModalTitle, bareInput } from './ui';
import { Spinner } from './motion';

const STATUS_LABEL: Record<'open' | 'paid' | 'voided', string> = {
  open: 'Open',
  paid: 'Paid',
  voided: 'Voided',
};

export function OrderDetail({ mayDelete }: { mayDelete: boolean }) {
  const { state, actions } = usePos();
  const order = state.viewOrder;

  if (!order && !state.viewOrderLoading) return null;

  if (!order) {
    return (
      <ModalOverlay maxWidth={520}>
        <p style={{ margin: 0, padding: '32px 0', textAlign: 'center', color: 'rgba(0,0,0,0.58)' }}>
          Loading order…
        </p>
      </ModalOverlay>
    );
  }

  const confirming = state.deleteOrderId === order.id;

  return (
    <ModalOverlay maxWidth={520}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <ModalTitle>Order #{order.orderNo}</ModalTitle>
        <button
          type="button"
          className="press"
          onClick={actions.closeOrderDetail}
          aria-label="Close"
          style={{ border: 0, background: 'transparent', padding: 4, cursor: 'pointer' }}
        >
          <Icon icon="lucide:x" size={18} color="rgba(0,0,0,0.45)" />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          fontSize: 13,
          fontWeight: 600,
          color: 'rgba(0,0,0,0.58)',
        }}
      >
        <span style={{ textTransform: 'capitalize' }}>{order.type}</span>
        <span>{STATUS_LABEL[order.status]}</span>
        {order.paymentMethod ? (
          <span style={{ textTransform: 'capitalize' }}>Paid by {order.paymentMethod}</span>
        ) : null}
        <span>{new Date(order.createdAt).toLocaleString()}</span>
      </div>

      {order.status === 'voided' && order.voidReason ? (
        <p
          style={{
            margin: 0,
            padding: '10px 12px',
            borderRadius: 10,
            background: '#f4f3f0',
            fontSize: 13,
            fontWeight: 500,
            color: 'rgba(0,0,0,0.58)',
          }}
        >
          Voided — {order.voidReason}
        </p>
      ) : null}

      {/* Lines carry the price as it was at the moment of sale, not today's
          menu price, which is why a repriced item still totals correctly. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {order.items.map((line) => (
          <div
            key={line.id}
            style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
              {line.qty} × {line.name}
              {line.note ? (
                <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}> · {line.note}</span>
              ) : null}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
              {money(line.lineTotal)}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          paddingTop: 10,
          borderTop: '1px solid #edebe9',
        }}
      >
        <Row label={`Subtotal · ${plural(order.items.length, 'line')}`} value={money(order.subtotal)} />
        {order.discountMinor > 0 ? (
          <Row
            label={
              order.discountType === 'percent'
                ? `Discount (${order.discountValue}%)`
                : `Discount (${CURRENCY} off)`
            }
            value={`− ${money(order.discount)}`}
          />
        ) : null}
        {order.taxMinor > 0 ? (
          <Row label={`Tax (${order.taxRate}%)`} value={money(order.tax)} />
        ) : null}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: 8,
            borderTop: '1px solid #edebe9',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#00754A' }}>
            {money(order.total)}
          </span>
        </div>
      </div>

      {mayDelete ? (
        confirming ? (
          /*
           * Deliberately more friction than a confirm dialog. The reason is
           * required by the server anyway, so asking for it here is not an
           * extra hoop — it is the same hoop, surfaced before the round trip,
           * and typing it is what makes the decision deliberate.
           */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 14,
              borderRadius: 12,
              border: '1px solid rgba(200,32,20,0.35)',
              background: 'rgba(200,32,20,0.05)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#c82014' }}>
              This permanently removes the order
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
              Today&rsquo;s takings will no longer reconcile against the till, and the only record
              left will be the audit log. Void the order instead if you just need to cancel it.
            </span>
            <input
              type="text"
              autoFocus
              placeholder="Reason (at least 10 characters)"
              value={state.deleteOrderReason}
              onChange={(e) => actions.patch({ deleteOrderReason: e.target.value })}
              style={{ ...bareInput, padding: '8px 10px', background: '#ffffff', borderRadius: 8 }}
            />
            {state.deleteOrderError ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#c82014' }}>
                {state.deleteOrderError}
              </span>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="press"
                onClick={() => void actions.confirmDeleteOrder()}
                disabled={state.deleteOrderBusy}
                style={{
                  ...dangerButton,
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  ...(state.deleteOrderBusy ? { opacity: 0.75, cursor: 'default' } : null),
                }}
              >
                {state.deleteOrderBusy ? <Spinner size={14} /> : null}
                {state.deleteOrderBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                type="button"
                className="press"
                onClick={actions.cancelDeleteOrder}
                disabled={state.deleteOrderBusy}
                style={{
                  ...dangerButton,
                  flex: 1,
                  background: 'transparent',
                  color: '#1E3932',
                  ...(state.deleteOrderBusy ? { opacity: 0.5, cursor: 'default' } : null),
                }}
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="press"
            onClick={() => actions.askDeleteOrder(order.id)}
            style={{
              ...dangerButton,
              background: 'transparent',
              color: '#c82014',
              alignSelf: 'flex-start',
            }}
          >
            <Icon icon="lucide:trash-2" size={15} />
            Delete order
          </button>
        )
      ) : null}
    </ModalOverlay>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const dangerButton = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '10px 18px',
  borderRadius: 50,
  border: '1px solid #c82014',
  background: '#c82014',
  color: '#ffffff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
} as const;
