/**
 * The Salary tab — monthly payroll, computed from attendance.
 *
 * ── The one thing to understand here ───────────────────────────────────────
 * A DRAFT month is live: its figures are recomputed from attendance on every
 * load, so correcting a day immediately corrects the wage. A PAID month is
 * frozen: what was handed over on the 3rd is a fact, and marking a correction
 * on the 10th must not restate it. The badge on each row is therefore not
 * decoration — it says whether the number beside it can still move.
 *
 * "Reopen" exists because the alternative is a mispayment being permanent.
 */
import { useEffect } from 'react';
import { usePos } from '../store';
import { Icon } from '../icons/Icon';
import { money } from '../lib/format';
import { useIsMobile } from '../lib/useViewport';
import { LoadState, StatusBadge, card, tableHeaderCell } from '../components/ui';
import { SkeletonRows } from '../components/motion';

const GRID = '1.3fr 0.9fr 0.8fr 0.8fr 0.8fr 0.9fr 0.7fr 150px';

export function EmployeeSalary() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();

  useEffect(() => {
    void actions.loadPayroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.payMonth]);

  const totals = state.payTotals;

  return (
    <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            borderRadius: 50,
            border: '1px solid #d6dbde',
            background: '#ffffff',
          }}
        >
          <Icon icon="lucide:banknote" size={15} />
          <input
            type="month"
            value={state.payMonth}
            onChange={(e) => actions.setPayMonth(e.target.value)}
            style={{ border: 0, background: 'transparent', fontSize: 14, fontWeight: 700 }}
          />
        </label>

        {totals ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
            {totals.paid} of {totals.employees} paid
          </span>
        ) : null}

        {totals ? (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 14,
              fontWeight: 700,
              color: 'rgba(0,0,0,0.87)',
            }}
          >
            Month total {money(totals.net)}
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: isMobile ? 'none' : 'grid',
          gridTemplateColumns: GRID,
          gap: 10,
          padding: '0 12px',
          alignItems: 'center',
        }}
      >
        {['Employee', 'Base', 'Days', 'Earned', 'Bonus', 'Deduction', 'Net', ''].map((label, i) => (
          <span key={i} style={tableHeaderCell}>
            {label}
          </span>
        ))}
      </div>

      {state.payRows.map((row) => {
        const paid = row.status === 'paid';
        return (
          <div
            key={row.employeeId}
            className="cells"
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr auto' : GRID,
              gap: isMobile ? 8 : 10,
              alignItems: 'center',
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${paid ? '#bfe0d4' : '#e8ecef'}`,
              background: paid ? '#f4faf8' : '#ffffff',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                {row.name}
              </span>
              <StatusBadge
                bg={paid ? '#d4e9e2' : '#eceff1'}
                fg={paid ? '#00754A' : 'rgba(0,0,0,0.45)'}
                label={paid ? 'Paid' : 'Draft'}
              />
            </span>

            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.58)' }}>{money(row.baseSalary)}</span>

            {/*
              Marked days, not payable days — the gap between this and the
              month length is what tells an admin they still have a roster to
              fill in, rather than that somebody was absent.
            */}
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.58)' }}>
              {row.markedDays}/{row.daysInMonth}
              {row.payableDays !== row.markedDays ? (
                <span style={{ color: 'rgba(0,0,0,0.45)' }}> · {row.payableDays} paid</span>
              ) : null}
            </span>

            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
              {money(row.earned)}
            </span>
            <span style={{ fontSize: 13, color: row.bonus ? '#00754A' : 'rgba(0,0,0,0.45)' }}>
              {row.bonus ? `+${money(row.bonus)}` : '—'}
            </span>
            <span style={{ fontSize: 13, color: row.deduction ? '#c82014' : 'rgba(0,0,0,0.45)' }}>
              {row.deduction ? `−${money(row.deduction)}` : '—'}
            </span>
            {/*
              The net figure, and — once settled — the day the money actually
              went out. "Paid" on its own answers whether; a month-end query is
              always about when.
            */}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                {money(row.net)}
              </span>
              {row.paidAt ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
                  Paid {new Date(row.paidAt).toLocaleDateString()}
                </span>
              ) : null}
            </span>

            <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {paid ? (
                <button
                  type="button"
                  className="press hv-neutral"
                  onClick={() => void actions.unmarkPayrollPaid(row.employeeId)}
                  style={smallPill}
                >
                  Reopen
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="press hv-neutral"
                    onClick={() => actions.openPayModal(row.employeeId)}
                    style={smallPill}
                  >
                    Adjust
                  </button>
                  <button
                    type="button"
                    className="press hv-primary"
                    onClick={() => void actions.markPayrollPaid(row.employeeId)}
                    style={{ ...smallPill, border: '1px solid #00754A', background: '#00754A', color: '#ffffff' }}
                  >
                    Pay
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}

      <LoadState
        loading={state.payLoading}
        skeleton={<SkeletonRows count={4} height={72} />}
        error={state.payError}
        empty={!state.payLoading && !state.payError && state.payRows.length === 0}
        emptyMessage="No staff on payroll. Add an employee and set their monthly salary."
        onRetry={() => void actions.loadPayroll()}
      />
    </section>
  );
}

const smallPill = {
  padding: '8px 14px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#ffffff',
  color: 'rgba(0,0,0,0.87)',
  fontSize: 12,
  fontWeight: 700,
} as const;
