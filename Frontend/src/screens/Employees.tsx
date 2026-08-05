/**
 * Employees — staff records, attendance and salary.
 *
 * Admin only. The sidebar omits this entry for anyone without `user:manage`,
 * App.tsx refuses to render it, and every endpoint behind it 403s — the last of
 * those is the one that actually enforces it.
 *
 * Three tabs rather than three screens: they are one subject seen three ways,
 * and attendance only means anything against the roster on the first tab.
 */
import { useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { money } from '../lib/format';
import { useIsMobile } from '../lib/useViewport';
import {
  FilterPill,
  IconButton,
  LoadState,
  PageHeading,
  SearchInput,
  StatusBadge,
  Toggle,
  card,
  primaryPill,
  tableHeaderCell,
} from '../components/ui';
import { EmployeeAttendance } from './employeeAttendance';
import { EmployeeSalary } from './employeeSalary';
import {
  EmployeeModal,
  EmployeePinModal,
  EmployeeDeleteModal,
  PayrollAdjustModal,
} from '../components/employeeModals';

const TABS = [
  { id: 'list', label: 'Employee List' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'salary', label: 'Salary' },
] as const;

/** Roles get a colour so a kitchen hand is distinguishable at a glance. */
const ROLE_BADGE: Record<string, { bg: string; fg: string }> = {
  admin: { bg: '#efe6cf', fg: '#8a6a24' },
  cashier: { bg: '#d4e9e2', fg: '#00754A' },
  kitchen_staff: { bg: '#e2e6ea', fg: '#1E3932' },
};

const GRID = '1.6fr 1fr 1.1fr 0.9fr 1fr 0.7fr 108px';

export function Employees() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();

  useEffect(() => {
    void actions.loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.empShowInactive]);

  const query = state.empQuery.trim().toLowerCase();
  const list = state.employees.filter(
    (e) =>
      !query ||
      e.name.toLowerCase().includes(query) ||
      e.phone.replace(/\s/g, '').includes(query.replace(/\s/g, '')),
  );

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
          overflowY: 'auto',
        }}
      >
        <PageHeading
          title="Employees"
          subtitle="Staff accounts, attendance and salary"
          right={
            state.empTab === 'list' ? (
              <button
                type="button"
                className="press hv-primary"
                onClick={() => actions.openEmpModal(null)}
                style={primaryPill}
              >
                <Icon icon="lucide:plus" size={15} /> Add Employee
              </button>
            ) : undefined
          }
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((tab) => (
            <FilterPill
              key={tab.id}
              label={tab.label}
              active={state.empTab === tab.id}
              onClick={() => actions.setEmpTab(tab.id)}
            />
          ))}
        </div>

        {state.empTab === 'list' ? (
          <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <SearchInput
                placeholder="Search by name or phone"
                value={state.empQuery}
                onChange={actions.setEmpQuery}
                style={{ flex: 1, minWidth: 220 }}
              />
              <button
                type="button"
                className="press hv-neutral"
                onClick={actions.toggleEmpInactive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 50,
                  border: '1px solid #d6dbde',
                  background: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.58)',
                }}
              >
                <Toggle on={state.empShowInactive} /> Show deactivated
              </button>
            </div>

            {/* Column headings only make sense while there are columns. */}
            <div
              style={{
                display: isMobile ? 'none' : 'grid',
                gridTemplateColumns: GRID,
                gap: 10,
                padding: '0 12px',
                alignItems: 'center',
              }}
            >
              {['Name', 'Role', 'Phone', 'Joined', 'Salary', 'Active', ''].map((headingLabel, i) => (
                <span key={i} style={tableHeaderCell}>
                  {headingLabel}
                </span>
              ))}
            </div>

            {list.map((employee) => {
              // The server refuses these on your own account; hiding them
              // avoids offering a control that can only fail.
              const isSelf = employee.id === state.user?.id;
              const badge = ROLE_BADGE[employee.role] ?? ROLE_BADGE.cashier;

              return (
                <div
                  key={employee.id}
                  className="cells"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr auto' : GRID,
                    gap: isMobile ? 8 : 10,
                    alignItems: 'center',
                    padding: '12px',
                    borderRadius: 10,
                    border: '1px solid #e8ecef',
                    background: employee.isActive ? '#ffffff' : '#faf9f7',
                    opacity: employee.isActive ? 1 : 0.62,
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                      {employee.name}
                      {isSelf ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#00754A' }}> · you</span>
                      ) : null}
                    </span>
                    {!employee.hasPin && employee.role !== 'admin' ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#c82014' }}>
                        No PIN — cannot sign in
                      </span>
                    ) : null}
                  </span>

                  <StatusBadge bg={badge.bg} fg={badge.fg} label={employee.roleLabel} />

                  <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.58)' }}>
                    {employee.phone || '—'}
                  </span>
                  <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.58)' }}>
                    {employee.joinedOn || '—'}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                    {employee.monthlySalary ? money(employee.monthlySalary) : '—'}
                  </span>

                  {isSelf ? (
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>—</span>
                  ) : (
                    <button
                      type="button"
                      className="press"
                      title={employee.isActive ? 'Deactivate' : 'Reactivate'}
                      onClick={() => void actions.toggleEmployeeActive(employee.id)}
                      style={{ border: 0, background: 'transparent', padding: 0, justifySelf: 'start' }}
                    >
                      <Toggle on={employee.isActive} />
                    </button>
                  )}

                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <IconButton
                      icon="lucide:pencil"
                      title="Edit details"
                      onClick={() => actions.openEmpModal(employee)}
                    />
                    {employee.role === 'admin' ? null : (
                      <IconButton
                        icon="lucide:key-round"
                        title="Set login PIN"
                        onClick={() => actions.openPinModal(employee.id)}
                      />
                    )}
                    {isSelf ? null : (
                      <IconButton
                        icon="lucide:trash-2"
                        title="Remove employee"
                        danger
                        onClick={() => actions.openEmpDelete(employee.id)}
                      />
                    )}
                  </span>
                </div>
              );
            })}

            <LoadState
              loading={state.empLoading}
              error={state.empLoadError}
              empty={!state.empLoading && !state.empLoadError && list.length === 0}
              emptyMessage={
                query ? 'Nobody matches that search.' : 'No staff yet — add your first employee.'
              }
              onRetry={() => void actions.loadEmployees()}
            />
          </section>
        ) : null}

        {state.empTab === 'attendance' ? <EmployeeAttendance /> : null}
        {state.empTab === 'salary' ? <EmployeeSalary /> : null}
      </main>

      <EmployeeModal />
      <EmployeePinModal />
      <EmployeeDeleteModal />
      <PayrollAdjustModal />
    </>
  );
}
