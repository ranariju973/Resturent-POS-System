/**
 * Table endpoints.
 *
 * ── Every transition is compare-and-swap ───────────────────────────────────
 * Seating, reserving, releasing and transferring are conditional updates on
 * the server: it filters on the status it expects to find, so two terminals
 * seating the same table means one succeeds and the other gets a 409. That is
 * the whole point — a lost race must surface as "someone got there first",
 * never as a silent overwrite.
 *
 * So every caller here has to handle ApiError with status 409 and refetch,
 * rather than assuming its own optimistic state won.
 */
import { api } from './api';
import type { TableDto } from './dto';
import { toTable } from './dto';
import type { Table } from '../data/types';

/**
 * `withZones` folds the zone list into this response instead of costing a
 * second request. Opt in on a first load, leave it off for the floor plan's
 * 15-second poll — the tables change constantly, the zone names almost never.
 */
export async function listTables(
  filter: { zone?: string; status?: string; withZones?: boolean } = {},
  signal?: AbortSignal,
): Promise<{ tables: Table[]; zones?: string[] }> {
  const qs = new URLSearchParams();
  if (filter.zone && filter.zone !== 'All') qs.set('zone', filter.zone);
  if (filter.status) qs.set('status', filter.status);
  if (filter.withZones) qs.set('withZones', 'true');

  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await api<{ tables: TableDto[]; zones?: string[] }>(`/api/tables${suffix}`, {
    signal,
  });
  return { tables: data.tables.map(toTable), zones: data.zones };
}

/** Zone names in use. Declared before /:id server-side, so 'zones' is not an id. */
export async function listZones(signal?: AbortSignal): Promise<string[]> {
  const data = await api<{ zones: string[] }>('/api/tables/zones', { signal });
  return data.zones;
}

export async function createTable(input: {
  name: string;
  seats: number;
  zone: string;
}): Promise<Table> {
  const data = await api<{ table: TableDto }>('/api/tables', { method: 'POST', body: input });
  return toTable(data.table);
}

export async function updateTable(
  id: string,
  input: { name?: string; seats?: number; zone?: string },
): Promise<Table> {
  const data = await api<{ table: TableDto }>(`/api/tables/${id}`, { method: 'PUT', body: input });
  return toTable(data.table);
}

/** Soft delete, so historical orders keep resolving. Refused while occupied. */
export async function deleteTable(id: string): Promise<void> {
  await api<{ deleted: boolean; id: string }>(`/api/tables/${id}`, { method: 'DELETE' });
}

export async function seatTable(id: string, partySize?: number): Promise<Table> {
  const data = await api<{ table: TableDto }>(`/api/tables/${id}/seat`, {
    method: 'PATCH',
    body: partySize === undefined ? {} : { partySize },
  });
  return toTable(data.table);
}

export async function reserveTable(
  id: string,
  input: { partySize?: number; note?: string } = {},
): Promise<Table> {
  const data = await api<{ table: TableDto }>(`/api/tables/${id}/reserve`, {
    method: 'PATCH',
    body: input,
  });
  return toTable(data.table);
}

/** Refused (409) while the table still holds an open bill. */
export async function releaseTable(id: string): Promise<Table> {
  const data = await api<{ table: TableDto }>(`/api/tables/${id}/release`, { method: 'PATCH' });
  return toTable(data.table);
}

/**
 * Move a party to another table. The server claims the destination before
 * releasing the source, so a failed transfer leaves the party where they were
 * rather than stranded between two tables.
 */
export async function transferTable(
  id: string,
  targetTableId: string,
): Promise<{ source: Table; target: Table }> {
  const data = await api<{ source: TableDto; target: TableDto }>(`/api/tables/${id}/transfer`, {
    method: 'POST',
    body: { targetTableId },
  });
  return { source: toTable(data.source), target: toTable(data.target) };
}

/** Refused when both tables hold bills, and refused if it would build a chain. */
export async function mergeTables(id: string, targetTableId: string): Promise<Table> {
  const data = await api<{ table: TableDto }>(`/api/tables/${id}/merge`, {
    method: 'POST',
    body: { targetTableId },
  });
  return toTable(data.table);
}

export async function unmergeTable(id: string): Promise<Table> {
  const data = await api<{ table: TableDto }>(`/api/tables/${id}/unmerge`, { method: 'POST' });
  return toTable(data.table);
}

/**
 * Split the bill N ways. Persists nothing — it is an arithmetic helper that
 * returns the per-share amounts, and the shares always sum back to the exact
 * total (₹10 three ways is 3.34 / 3.33 / 3.33, never 3×3.33).
 */
export interface SplitShare {
  index: number;
  amountMinor: number;
  amount: number;
}

export interface SplitResult {
  tableId: string;
  orderId: string;
  orderNo: number;
  ways: number;
  totalMinor: number;
  total: number;
  shares: SplitShare[];
  /** The server's own proof the shares sum back to the total. */
  checksumMinor: number;
}

export async function splitBill(id: string, ways: number): Promise<SplitResult> {
  return api<SplitResult>(`/api/tables/${id}/split`, { method: 'POST', body: { ways } });
}
