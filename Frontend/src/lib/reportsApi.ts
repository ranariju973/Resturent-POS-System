/**
 * Reports endpoints.
 *
 * ── Gaps are filled server-side, on purpose ────────────────────────────────
 * The daily report returns all 24 hours, the monthly one every day of the
 * month, and the P&L every expense category — including the ones at zero. A
 * chart that silently omits an empty hour draws a shorter axis than yesterday
 * and invites the reader to compare two differently-shaped pictures. So none
 * of these arrays need padding here; they arrive complete.
 *
 * Everything is admin-only (`reports:view`). A cashier calling any of it gets
 * a 403, which the screen surfaces rather than showing an empty chart.
 */
import { api } from './api';

export type ExpenseCategory = 'Ingredients' | 'Utilities' | 'Salary' | 'Rent' | 'Other';

export interface DailyReport {
  date: string;
  gross: number;
  discount: number;
  net: number;
  orders: number;
  averageOrderMinor: number;
  voidedOrders: number;
  byPaymentMethod: { method: string; total: number; orders: number }[];
  byOrderType: { type: string; total: number; orders: number }[];
  /** Always 24 entries, hour 0-23. */
  hourly: { hour: number; totalMinor: number; orders: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
}

export interface MonthlyReport {
  month: string;
  net: number;
  orders: number;
  expenses: number;
  profit: number;
  /** Null when there is no prior month — distinct from 0, which means no change. */
  changePercent: number | null;
  /** One entry per day of the month. */
  daily: { day: number; totalMinor: number; orders: number }[];
  /** Same shape as DailyReport's, so one component renders either. */
  byPaymentMethod: { method: string; total: number; orders: number }[];
}

export interface PnlReport {
  from: string;
  to: string;
  revenue: { gross: number; discount: number; net: number; orders: number };
  expenses: {
    total: number;
    byCategory: { category: ExpenseCategory; total: number }[];
  };
  profit: number;
  marginPercent: number | null;
}

export interface ExpenseRow {
  id: string;
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
}

export async function getDaily(date?: string, signal?: AbortSignal): Promise<DailyReport> {
  const qs = date ? `?date=${date}` : '';
  return api<DailyReport>(`/api/reports/daily${qs}`, { signal });
}

export async function getMonthly(month?: string, signal?: AbortSignal): Promise<MonthlyReport> {
  const qs = month ? `?month=${month}` : '';
  return api<MonthlyReport>(`/api/reports/monthly${qs}`, { signal });
}

export async function getPnl(
  range: { from?: string; to?: string } = {},
  signal?: AbortSignal,
): Promise<PnlReport> {
  const qs = new URLSearchParams();
  if (range.from) qs.set('from', range.from);
  if (range.to) qs.set('to', range.to);
  const suffix = qs.toString() ? `?${qs}` : '';
  return api<PnlReport>(`/api/reports/pnl${suffix}`, { signal });
}

export async function listExpenses(
  filter: { from?: string; to?: string; category?: ExpenseCategory; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ expenses: ExpenseRow[]; totalAmount: number }> {
  const qs = new URLSearchParams();
  if (filter.from) qs.set('from', filter.from);
  if (filter.to) qs.set('to', filter.to);
  if (filter.category) qs.set('category', filter.category);
  qs.set('limit', String(filter.limit ?? 100));

  const data = await api<{ expenses: ExpenseRow[]; totalAmount: number }>(
    `/api/reports/expenses?${qs}`,
    { signal },
  );
  return { expenses: data.expenses, totalAmount: data.totalAmount };
}

/** `amount` is major units as text — the server converts and stores integers. */
export async function createExpense(input: {
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
}): Promise<ExpenseRow> {
  const data = await api<{ expense: ExpenseRow }>('/api/reports/expenses', {
    method: 'POST',
    body: input,
  });
  return data.expense;
}

export async function deleteExpense(id: string): Promise<void> {
  await api<{ deleted: boolean; id: string }>(`/api/reports/expenses/${id}`, { method: 'DELETE' });
}
