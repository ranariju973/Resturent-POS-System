/**
 * Employees, attendance and payroll.
 *
 * Every endpoint here is `user:manage`, so every call in this file 403s for
 * anyone but an admin. The screen hides itself from other roles, but that is
 * cosmetic — this is the boundary the server actually defends.
 *
 * Nothing here catches. An ApiError propagates to the store action, which
 * decides between a toast and an inline message — the duplicate-PIN 409 in
 * particular has to land beside the field the admin is still looking at.
 */
import { api } from './api';
import {
  toEmployee,
  toAttendanceRow,
  toPayrollRow,
  type EmployeeDto,
  type AttendanceDayDto,
  type AttendanceMonthDto,
  type PayrollRowDto,
} from './dto';
import type {
  AttendanceRow,
  AttendanceStatus,
  Employee,
  PayrollRow,
  PayrollTotals,
  StaffRole,
} from '../data/types';

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface EmployeeInput {
  name: string;
  role: StaffRole;
  phone?: string;
  joinedOn?: string;
  monthlySalary?: string | number;
  employmentNotes?: string;
}

export async function listEmployees(
  filter: { search?: string; includeInactive?: boolean } = {},
  signal?: AbortSignal,
): Promise<Employee[]> {
  const qs = new URLSearchParams();
  if (filter.search) qs.set('search', filter.search);
  if (filter.includeInactive) qs.set('includeInactive', 'true');
  qs.set('limit', '100');

  const data = await api<{ employees: EmployeeDto[]; total: number }>(
    `/api/employees?${qs}`,
    { signal },
  );
  return data.employees.map(toEmployee);
}

/** The PIN is part of creation: a staff account without one cannot be used. */
export async function createEmployee(
  input: EmployeeInput & { pin: string },
): Promise<Employee> {
  const data = await api<{ employee: EmployeeDto }>('/api/employees', {
    method: 'POST',
    body: input,
  });
  return toEmployee(data.employee);
}

export async function updateEmployee(
  id: string,
  input: Partial<EmployeeInput>,
): Promise<Employee> {
  const data = await api<{ employee: EmployeeDto }>(`/api/employees/${id}`, {
    method: 'PUT',
    body: input,
  });
  return toEmployee(data.employee);
}

/**
 * Set a login PIN. Returns nothing useful on purpose — the server does not echo
 * the PIN back, and there is no reason for it to travel twice.
 */
export async function setEmployeePin(id: string, pin: string): Promise<void> {
  await api<{ id: string; pinSet: boolean }>(`/api/employees/${id}/pin`, {
    method: 'PATCH',
    body: { pin },
  });
}

export async function setEmployeeActive(id: string, isActive: boolean): Promise<Employee> {
  const data = await api<{ employee: EmployeeDto }>(`/api/employees/${id}/active`, {
    method: 'PATCH',
    body: { isActive },
  });
  return toEmployee(data.employee);
}

/**
 * Permanently remove an account. Expect a 409 for anyone who has worked a
 * shift — the server refuses rather than orphaning their orders, and the
 * message tells the admin to deactivate instead.
 */
export async function deleteEmployee(id: string): Promise<void> {
  await api<{ deleted: boolean; id: string }>(`/api/employees/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/** One day as a complete roster — unmarked staff come back with a null status. */
export async function getAttendanceDay(
  date: string,
  signal?: AbortSignal,
): Promise<{ rows: AttendanceRow[]; marked: number }> {
  const data = await api<AttendanceDayDto>(`/api/attendance/day?date=${date}`, { signal });
  return { rows: data.rows.map(toAttendanceRow), marked: data.marked };
}

/**
 * One employee's whole month, for the attendance calendar.
 *
 * Returns a plain `{ 'YYYY-MM-DD': status }` map: the calendar looks days up by
 * date and has no use for the record ids. Keys are sliced from the server's ISO
 * string rather than parsed into a Date — the server stores each day at UTC
 * midnight, and re-parsing in a +05:30 timezone would shift every date back by
 * one and paint the wrong squares.
 */
export async function getAttendanceMonth(
  month: string,
  employeeId: string,
  signal?: AbortSignal,
): Promise<{ days: Record<string, AttendanceStatus>; daysInMonth: number }> {
  const data = await api<AttendanceMonthDto>(
    `/api/attendance?month=${month}&employee=${employeeId}`,
    { signal },
  );

  const days: Record<string, AttendanceStatus> = {};
  for (const record of data.employees[0]?.records ?? []) {
    days[record.date.slice(0, 10)] = record.status;
  }
  return { days, daysInMonth: data.daysInMonth };
}

/**
 * Save a whole day in one request.
 *
 * The batch shape matters: the server turns it into a single idempotent
 * bulkWrite, so re-saving a day corrects it rather than duplicating it.
 */
export async function markAttendanceDay(
  date: string,
  entries: Array<{ employee: string; status: AttendanceStatus; notes?: string }>,
): Promise<void> {
  await api<{ date: string; marked: number }>('/api/attendance/day', {
    method: 'POST',
    body: { date, entries },
  });
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export async function getPayroll(
  month: string,
  signal?: AbortSignal,
): Promise<{ rows: PayrollRow[]; totals: PayrollTotals }> {
  const data = await api<{ rows: PayrollRowDto[]; totals: PayrollTotals }>(
    `/api/payroll?month=${month}`,
    { signal },
  );
  return { rows: data.rows.map(toPayrollRow), totals: data.totals };
}

export async function adjustPayroll(
  employeeId: string,
  month: string,
  input: { bonus?: string; deduction?: string; notes?: string },
): Promise<PayrollRow> {
  const data = await api<{ row: PayrollRowDto }>(`/api/payroll/${employeeId}/${month}`, {
    method: 'PATCH',
    body: input,
  });
  return toPayrollRow(data.row);
}

/** Settle a month. This freezes the figures — see the server's Payroll model. */
export async function markPayrollPaid(
  employeeId: string,
  month: string,
  notes = '',
): Promise<PayrollRow> {
  const data = await api<{ row: PayrollRowDto }>(`/api/payroll/${employeeId}/${month}/pay`, {
    method: 'POST',
    body: { notes },
  });
  return toPayrollRow(data.row);
}

/** Reopen a settled month, so the figures track attendance again. */
export async function unmarkPayrollPaid(
  employeeId: string,
  month: string,
): Promise<PayrollRow> {
  const data = await api<{ row: PayrollRowDto }>(`/api/payroll/${employeeId}/${month}/unpay`, {
    method: 'POST',
  });
  return toPayrollRow(data.row);
}
