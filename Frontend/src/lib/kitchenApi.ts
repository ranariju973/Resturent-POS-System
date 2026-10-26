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
 * A short-lived stream credential is sent in an Authorization header using
 * fetch streaming. It is renewed before expiry and never put in a request URL.
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
  nextResetAt: string;
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
    nextResetAt: string;
  }>(`/api/kitchen/board${suffix}`, { signal });

  const columns = Object.fromEntries(
    Object.entries(data.columns).map(([status, tickets]) => [status, tickets.map(toTicket)]),
  ) as Board;

  return { columns, counts: data.counts, servedWithinMinutes: data.servedWithinMinutes, nextResetAt: data.nextResetAt };
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

export async function createStreamToken(signal?: AbortSignal): Promise<{ token: string; expiresInSeconds: number }> {
  return api<{ token: string; expiresInSeconds: number }>('/api/kitchen/stream-token', {
    method: 'POST', signal,
  });
}

/**
 * Open the live board stream.
 *
 * Returns a cleanup function. The caller is responsible for calling it — an
 * stream left open survives the component that made it and will keep
 * reconnecting after the screen is gone.
 */
export async function openBoardStream(onChange: () => void, onConnection: (connected: boolean) => void = () => {}): Promise<() => void> {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const changed = () => {
    if (changeTimer) return;
    changeTimer = setTimeout(() => { changeTimer = undefined; if (!stopped) onChange(); }, 150);
  };
  const connect = async () => {
    if (stopped || document.hidden || controller) return;
    const current = new AbortController();
    controller = current;
    let renew = false;
    try {
      const { token, expiresInSeconds } = await createStreamToken(current.signal);
      if (stopped || current.signal.aborted) return;
      // Fetch streaming keeps even the short-lived credential out of proxy URL logs.
      const response = await fetch(`${BASE_URL}/api/kitchen/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: current.signal, credentials: 'include',
      });
      if (!response.ok || !response.body) throw new Error('Kitchen stream unavailable');
      attempt = 0;
      onConnection(true);
      changed();
      renewal = setTimeout(() => { renew = true; current.abort(); }, Math.max(1000, (expiresInSeconds - 5) * 1000));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const frames = pending.split('\n\n');
        pending = frames.pop() ?? '';
        for (const frame of frames) if (frame.startsWith('data:')) changed();
        if (pending.length > 1_000_000) throw new Error('Kitchen event exceeded size limit');
      }
    } catch { /* Polling remains available while the connection recovers. */ }
    finally {
      clearTimeout(renewal);
      current.abort();
      controller = undefined;
      onConnection(false);
      if (!stopped && !document.hidden) {
        timer = setTimeout(() => void connect(), renew ? 0 : Math.min(30_000, 1000 * 2 ** attempt++));
      }
    }
  };
  const visibility = () => {
    clearTimeout(timer);
    if (document.hidden) controller?.abort();
    else { changed(); if (!controller) void connect(); }
  };
  document.addEventListener('visibilitychange', visibility);
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer); clearTimeout(renewal); clearTimeout(changeTimer);
    controller?.abort();
    document.removeEventListener('visibilitychange', visibility);
  };
}
