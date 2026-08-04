import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import {
  DAY_ORDERS,
  EXP_CATS,
  HOURLY,
  MONTH_DAYS,
  MONTH_ORDERS,
  PAYMENTS,
  PREV_MONTH_EXPENSES,
  PREV_MONTH_SALES,
  TOP_ITEMS,
} from '../data/seed';
import type { ExpenseCategory } from '../data/types';
import { usePos } from '../store';
import { fmtDate, money } from '../lib/format';
import {
  ErrorLine,
  Field,
  FilterPill,
  ModalActions,
  ModalOverlay,
  ModalTitle,
  PageHeading,
  bareInput,
  card,
  tableHeaderCell,
} from '../components/ui';

const TABS = [
  ['daily', 'Daily Sales'],
  ['monthly', 'Monthly Sales'],
  ['expenses', 'Expense Report'],
  ['pnl', 'Profit & Loss'],
] as const;

const TOP_GRID: CSSProperties = {
  minWidth: 480,
  display: 'grid',
  gridTemplateColumns: '44px minmax(160px, 1fr) 120px 120px',
  gap: 12,
};

const EXPENSE_GRID: CSSProperties = {
  minWidth: 620,
  display: 'grid',
  gridTemplateColumns: '130px 130px minmax(180px, 1fr) 120px',
  gap: 12,
};

export function Reports() {
  const { state, actions } = usePos();
  const tab = state.repTab;

  const dayTotal = HOURLY.reduce((sum, [, v]) => sum + v, 0);
  const hourMax = Math.max(...HOURLY.map(([, v]) => v));
  const monthTotal = MONTH_DAYS.reduce((sum, v) => sum + v, 0);
  const dayMax = Math.max(...MONTH_DAYS);
  const delta = ((monthTotal - PREV_MONTH_SALES) / PREV_MONTH_SALES) * 100;
  const payTotal = PAYMENTS.reduce((sum, [, amt]) => sum + amt, 0);

  const expenses = state.expenses
    .slice()
    .sort((a, b) => (state.expDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const expTotal = expenses.reduce((sum, e) => sum + e.amt, 0);
  const byCategory = EXP_CATS.map((cat) => ({
    cat,
    amt: expenses.filter((e) => e.cat === cat).reduce((sum, e) => sum + e.amt, 0),
  })).filter((row) => row.amt > 0);

  const net = monthTotal - expTotal;
  const prevNet = PREV_MONTH_SALES - PREV_MONTH_EXPENSES;
  const netDelta = ((net - prevNet) / Math.abs(prevNet)) * 100;

  const topItems = TOP_ITEMS.map(([id, qty]) => {
    const item = state.items.find((x) => x.id === id);
    return { name: item ? item.name : id, qty, revenue: item ? item.price * qty : 0 };
  }).sort((a, b) => b.revenue - a.revenue);

  return (
    <>
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <PageHeading
          wrap
          title="Reports"
          subtitle="Read-only aggregation — corrections happen in POS Billing"
          right={
            <button
              type="button"
              className="press hv-green-fill"
              onClick={() => actions.flash('Report exported')}
              style={{
                padding: '11px 20px',
                borderRadius: 50,
                border: '1px solid #00754A',
                background: '#ffffff',
                color: '#00754A',
                fontSize: 14,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon icon="lucide:download" />
              Export CSV / PDF
            </button>
          }
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {TABS.map(([id, label]) => (
            <FilterPill
              key={id}
              label={label}
              active={id === tab}
              padding="9px 20px"
              onClick={() => actions.patch({ repTab: id })}
            />
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {tab === 'daily' ? (
              <input
                type="date"
                className="focus-green"
                value={state.repDate}
                onChange={(e) => actions.patch({ repDate: e.target.value })}
                style={datePicker}
              />
            ) : (
              <input
                type="month"
                className="focus-green"
                value={state.repMonth}
                onChange={(e) => actions.patch({ repMonth: e.target.value })}
                style={datePicker}
              />
            )}
          </span>
        </div>

        {tab === 'daily' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={statGrid}>
              <ReportStat
                icon="lucide:banknote"
                iconBg="#d4e9e2"
                iconColor="#00754A"
                label="Total Sales"
                value={money(dayTotal)}
                valueColor="#00754A"
              />
              <ReportStat
                icon="lucide:receipt"
                iconBg="#f2f0eb"
                iconColor="#1E3932"
                label="Total Orders"
                value={String(DAY_ORDERS)}
              />
              <ReportStat
                icon="lucide:divide"
                iconBg="#f2f0eb"
                iconColor="#1E3932"
                label="Average Order Value"
                value={money(dayTotal / DAY_ORDERS)}
              />
            </div>

            <ChartSection title="Sales by hour">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 10,
                  height: 200,
                  overflowX: 'auto',
                  paddingBottom: 4,
                }}
              >
                {HOURLY.map(([label, value]) => (
                  <span
                    key={label}
                    title={money(value)}
                    style={{
                      flex: 1,
                      minWidth: 34,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: '100%',
                        borderRadius: '8px 8px 3px 3px',
                        transition: 'height 0.2s ease',
                        height: `${Math.round((value / hourMax) * 100)}%`,
                        background: value === hourMax ? '#00754A' : '#a8cfc2',
                      }}
                    />
                    <span
                      style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}
                    >
                      {label}
                    </span>
                  </span>
                ))}
              </div>
            </ChartSection>

            <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 style={sectionTitle}>Top Selling Items</h2>
              <div style={{ overflowX: 'auto' }}>
                <div
                  style={{ ...TOP_GRID, padding: '0 12px 10px', borderBottom: '1px solid #edebe9' }}
                >
                  <span style={tableHeaderCell}>#</span>
                  <span style={tableHeaderCell}>Item</span>
                  <span style={{ ...tableHeaderCell, textAlign: 'right' }}>Qty sold</span>
                  <span style={{ ...tableHeaderCell, textAlign: 'right' }}>Revenue</span>
                </div>
                {topItems.map((row, i) => (
                  <div
                    key={`${row.name}-${i}`}
                    style={{
                      ...TOP_GRID,
                      alignItems: 'center',
                      padding: '13px 12px',
                      borderBottom: '1px solid #f4f3f0',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.45)' }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                      {row.name}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'rgba(0,0,0,0.58)',
                        textAlign: 'right',
                      }}
                    >
                      {row.qty}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#00754A',
                        textAlign: 'right',
                      }}
                    >
                      {money(row.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'monthly' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={statGrid}>
              <ReportStat
                icon="lucide:banknote"
                iconBg="#d4e9e2"
                iconColor="#00754A"
                label="Total Sales"
                value={money(monthTotal)}
                valueColor="#00754A"
              />
              <ReportStat
                icon="lucide:receipt"
                iconBg="#f2f0eb"
                iconColor="#1E3932"
                label="Total Orders"
                value={String(MONTH_ORDERS)}
              />
              <ReportStat
                icon="lucide:trending-up"
                iconBg={delta >= 0 ? '#d4e9e2' : 'rgba(200,32,20,0.10)'}
                iconColor={delta >= 0 ? '#00754A' : '#c82014'}
                label="vs. Last Month"
                value={`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}
                valueColor={delta >= 0 ? '#00754A' : '#c82014'}
              />
            </div>

            <ChartSection title="Sales by day">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 5,
                  height: 200,
                  overflowX: 'auto',
                  paddingBottom: 4,
                }}
              >
                {MONTH_DAYS.map((value, i) => (
                  <span
                    key={i}
                    style={{
                      flex: 1,
                      minWidth: 18,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: '100%',
                        borderRadius: '5px 5px 2px 2px',
                        transition: 'height 0.2s ease',
                        height: `${Math.round((value / dayMax) * 100)}%`,
                        background: value === dayMax ? '#00754A' : '#a8cfc2',
                      }}
                    />
                    <span
                      style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.32)' }}
                    >
                      {i + 1}
                    </span>
                  </span>
                ))}
              </div>
            </ChartSection>

            <ChartSection title="Payment methods">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {PAYMENTS.map(([name, amt, color]) => {
                  const pct = Math.round((amt / payTotal) * 100);
                  return (
                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <span
                          style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}
                        >
                          {name}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                          <span
                            style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}
                          >
                            {pct}%
                          </span>
                          <span
                            style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}
                          >
                            {money(amt)}
                          </span>
                        </span>
                      </span>
                      <span
                        style={{
                          height: 12,
                          borderRadius: 50,
                          background: '#f2f0eb',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            height: '100%',
                            borderRadius: 50,
                            transition: 'width 0.2s ease',
                            width: `${pct}%`,
                            background: color,
                          }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </ChartSection>
          </div>
        ) : null}

        {tab === 'expenses' ? (
          <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: 'rgba(0,0,0,0.45)',
                  }}
                >
                  Total expenses · {expenses.length} entries
                </span>
                <span
                  style={{
                    fontSize: 30,
                    fontWeight: 800,
                    lineHeight: 1,
                    color: 'rgba(0,0,0,0.87)',
                  }}
                >
                  {money(expTotal)}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="press hv-green"
                  onClick={() => actions.patch({ expDesc: !state.expDesc })}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 50,
                    border: '1px solid #d6dbde',
                    background: '#ffffff',
                    color: 'rgba(0,0,0,0.87)',
                    fontSize: 13,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Icon icon="lucide:arrow-up-down" size={15} />
                  {state.expDesc ? 'Newest first' : 'Oldest first'}
                </button>
                <button
                  type="button"
                  className="press hv-primary"
                  onClick={() => actions.patch({ modal: { kind: 'exp' }, expError: '' })}
                  style={{
                    padding: '11px 20px',
                    borderRadius: 50,
                    border: '1px solid #00754A',
                    background: '#00754A',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Icon icon="lucide:plus" />
                  Add Expense
                </button>
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <div
                style={{
                  ...EXPENSE_GRID,
                  padding: '0 12px 10px',
                  borderBottom: '1px solid #edebe9',
                }}
              >
                <span style={tableHeaderCell}>Date</span>
                <span style={tableHeaderCell}>Category</span>
                <span style={tableHeaderCell}>Description</span>
                <span style={{ ...tableHeaderCell, textAlign: 'right' }}>Amount</span>
              </div>
              {expenses.map((expense) => (
                <div
                  key={expense.id}
                  style={{
                    ...EXPENSE_GRID,
                    alignItems: 'center',
                    padding: '13px 12px',
                    borderBottom: '1px solid #f4f3f0',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.87)' }}>
                    {fmtDate(expense.date)}
                  </span>
                  <span
                    style={{
                      justifySelf: 'start',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 12px',
                      borderRadius: 50,
                      background: '#f2f0eb',
                      color: 'rgba(0,0,0,0.58)',
                    }}
                  >
                    {expense.cat}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
                    {expense.desc}
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'rgba(0,0,0,0.87)',
                      textAlign: 'right',
                    }}
                  >
                    {money(expense.amt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {tab === 'pnl' ? (
          <section
            style={{
              ...card,
              maxWidth: 640,
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            <h2 style={sectionTitle}>Profit &amp; Loss statement</h2>

            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 16,
                paddingBottom: 16,
                borderBottom: '1px solid #edebe9',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                Total Revenue
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, color: 'rgba(0,0,0,0.87)' }}>
                {money(monthTotal)}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                  Total Expenses
                </span>
                <span style={{ fontSize: 22, fontWeight: 800, color: 'rgba(0,0,0,0.87)' }}>
                  {money(expTotal)}
                </span>
              </span>
              {byCategory.map((row) => (
                <span
                  key={row.cat}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 16,
                    paddingLeft: 16,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
                    {row.cat}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
                    {money(row.amt)}
                  </span>
                </span>
              ))}
            </div>

            <span style={{ height: 3, borderRadius: 2, background: '#1E3932' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <span style={{ fontSize: 17, fontWeight: 800, color: 'rgba(0,0,0,0.87)' }}>
                  Net Profit
                </span>
                <span
                  style={{
                    fontSize: 38,
                    fontWeight: 800,
                    lineHeight: 1,
                    color: net >= 0 ? '#00754A' : '#c82014',
                  }}
                >
                  {net < 0 ? '−' : ''}
                  {money(Math.abs(net))}
                </span>
              </span>
              <span
                style={{
                  alignSelf: 'flex-end',
                  fontSize: 13,
                  fontWeight: 600,
                  color: net >= prevNet ? '#00754A' : '#c82014',
                }}
              >
                {netDelta >= 0 ? '▲ ' : '▼ '}
                {Math.abs(netDelta).toFixed(1)}% vs. previous period ({money(prevNet)})
              </span>
            </div>
          </section>
        ) : null}
      </main>

      <ExpenseModal />
    </>
  );
}

function ReportStat({
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
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: iconBg,
          color: iconColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon icon={icon} size={20} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'rgba(0,0,0,0.45)',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: valueColor }}>
          {value}
        </span>
      </span>
    </div>
  );
}

function ChartSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function ExpenseModal() {
  const { state, actions } = usePos();
  if (state.modal?.kind !== 'exp') return null;

  return (
    <ModalOverlay maxWidth={440} scroll>
      <ModalTitle>Add expense</ModalTitle>

      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Date" htmlFor="edate" style={{ flex: 1, minWidth: 0 }}>
          <input
            id="edate"
            type="date"
            value={state.expDraft.date}
            onChange={(e) => actions.setExpDraft({ date: e.target.value })}
            style={bareInput}
          />
        </Field>
        <Field label="Category" htmlFor="ecat" style={{ flex: 1, minWidth: 0 }}>
          <select
            id="ecat"
            value={state.expDraft.cat}
            onChange={(e) => actions.setExpDraft({ cat: e.target.value as ExpenseCategory })}
            style={{ ...bareInput, appearance: 'none' }}
          >
            {EXP_CATS.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description" htmlFor="edesc">
        <input
          id="edesc"
          type="text"
          placeholder="e.g. Produce — weekly market run"
          value={state.expDraft.desc}
          onChange={(e) => actions.setExpDraft({ desc: e.target.value })}
          style={bareInput}
        />
      </Field>

      <Field label="Amount" htmlFor="eamt">
        <input
          id="eamt"
          type="text"
          placeholder="0.00"
          value={state.expDraft.amt}
          onChange={(e) => actions.setExpDraft({ amt: e.target.value })}
          style={bareInput}
        />
      </Field>

      {state.expError ? <ErrorLine message={state.expError} /> : null}

      <ModalActions onCancel={actions.closeModal} onSave={actions.saveExpense} />
    </ModalOverlay>
  );
}

const statGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 16,
};

const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: 'rgba(0,0,0,0.87)',
};

const datePicker: CSSProperties = {
  padding: '9px 16px',
  borderRadius: 50,
  border: '1px solid #d6dbde',
  background: '#ffffff',
  fontSize: 14,
  fontWeight: 600,
  color: 'rgba(0,0,0,0.87)',
  outline: 'none',
};
