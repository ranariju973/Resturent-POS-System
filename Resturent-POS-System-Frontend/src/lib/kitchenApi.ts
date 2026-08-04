/**
 * Kitchen display endpoints.
 *
 * ── The board is grouped server-side ───────────────────────────────────────
 * `/board` returns tickets already bucketed into the four columns, with every
 * column present even when empty. Bucketing on the client would mean four
 * places that could disagree about which column holds a ticket; this way
 * there is one.
 *
 * ── Live updates need a separate token ─────────────────────────────────────
 * EventSource cannot send an Authorization header, so the stream is opened
 * with a short-lived token minted by `/stream-token` and passed in the query
 * string. That token is deliberately not the access token: query strings end
 * up in proxy logs and browser history, and a 60-second stream ticket leaking
 * there is a far smaller problem than a 15-minute access token doing so.
 */
import { api, BASE_URL } from './api';
import type { TicketDto } from './dto';
import { toTicket } from './dto';
import type { OrderType, Ticket, TicketStatus } from '../data/types';

export type Board = Record<TicketStatus, Ticket[]>;

export interface BoardResult {
  columns: Board;
  counts: Record<TicketStatus, number>;
  servedWithinMinutes: number;
}

export async function getBoard(
  filter: { type?: OrderType; servedWithinMinutes?: number } = {},
  signal?: AbortSignal,
): Promise<BoardResult> {
  const qs = new URLSearchParams();
  if (filter.type) qs.set('type', filter.type);
  if (filter.servedWithinMinutes !== undefined) {
    qs.set('servedWithinMinutes', String(filter.servedWithinMinutes));
  }

  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await api<{
    columns: Record<TicketStatus, TicketDto[]>;
    counts: Record<TicketStatus, number>;
    servedWithinMinutes: number;
  }>(`/api/kitchen/board${suffix}`, { signal });

  const columns = Object.fromEntries(
    Object.entries(data.columns).map(([status, tickets]) => [status, tickets.map(toTicket)]),
  ) as Board;

  return { columns, counts: data.counts, servedWithinMinutes: data.servedWithinMinutes };
}

/**
 * Move a ticket one column right.
 *
 * The target status is not a parameter: the server reads the next status from
 * its own transition map, so a ticket can never skip from pending straight to
 * served no matter what the client asks for.
 */
export async function advanceTicket(id: string): Promise<Ticket> {
  const data = await api<{ ticket: TicketDto }>(`/api/kitchen/tickets/${id}/advance`, {
    method: 'PATCH',
  });
  return toTicket(data.ticket);
}

/** Move a ticket back a column — the correction path, flagged in the history. */
export async function recallTicket(id: string): Promise<Ticket> {
  const data = await api<{ ticket: TicketDto }>(`/api/kitchen/tickets/${id}/recall`, {
    method: 'PATCH',
  });
  return toTicket(data.ticket);
}

export async function createStreamToken(): Promise<{ token: string; expiresInSeconds: number }> {
  return api<{ token: string; expiresInSeconds: number }>('/api/kitchen/stream-token', {
    method: 'POST',
  });
}

/**
 * Open the live board stream.
 *
 * Returns a cleanup function. The caller is responsible for calling it — an
 * EventSource left open survives the component that made it and will keep
 * reconnecting after the screen is gone.
 */
export async function openBoardStream(onChange: () => void): Promise<() => void> {
  const { token } = await createStreamToken();
  // Same base as every other call: with VITE_API_URL set, a relative URL
  // here would point the stream at the frontend origin instead of the API.
  const source = new EventSource(
    `${BASE_URL}/api/kitchen/stream?token=${encodeURIComponent(token)}`,
  );

  // Any server-sent event means the board moved; refetching is cheaper to get
  // right than patching local state from a partial event payload.
  source.onmessage = () => onChange();
  source.addEventListener('ticket', () => onChange());

  return () => source.close();
}
