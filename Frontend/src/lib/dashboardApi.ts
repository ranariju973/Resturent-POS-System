/**
 * Dashboard endpoint.
 *
 * ── Two payloads, one route ────────────────────────────────────────────────
 * A cashier gets today's figures; an admin gets those plus month totals, the
 * previous month for comparison, expenses and top items. The server decides
 * which by permission and reports which it sent in `scope` — the client never
 * asks for a scope, because a query parameter a cashier could set would be a
 * way to widen their own view. The route's schema rejects query parameters
 * entirely for exactly that reason.
 *
 * Everything admin-only is optional here, so reading a month figure without
 * checking `scope` is a type error rather than a runtime `undefined`.
 */
import { api } from './api';
import type { OrderType } from '../data/types';

export interface RecentOrder {
  id: string;
  orderNo: number;
  type: OrderType;
  status: 'open' | 'paid' | 'voided';
  totalMinor: number;
  total: number;
  itemCount: number;
  createdAt: string;
}

export interface DashboardData {
  scope: 'full' | 'limited';

  todaySales: number;
  todayOrders: number;
  pendingOrders: number;
  completedOrders: number;
  recentOrders: RecentOrder[];

  // --- Admin only. Absent entirely on the limited payload. ---
  monthSales?: number;
  monthOrders?: number;
  prevMonthSales?: number;
  /** Null when there is no prior month — distinct from 0, which means no change. */
  salesChangePercent?: number | null;
  monthExpenses?: number;
  monthNet?: number;
  /** Null when there is no revenue to take a margin of. */
  marginPercent?: number | null;
  topItems?: { name: string; qty: number; revenue: number }[];
}

export async function getDashboard(signal?: AbortSignal): Promise<DashboardData> {
  return api<DashboardData>('/api/dashboard', { signal });
}
