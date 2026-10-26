import { useEffect } from 'react';
import { operationalWindow } from './serviceDay';

/** Reload on entry, visibility restoration, and the server's next service boundary. */
export function useOperationalRefresh(refresh: () => Promise<void>, resetAt?: string | null) {
  useEffect(() => {
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const at = resetAt ? Date.parse(resetAt) : operationalWindow().nextResetAt;
      // If the boundary request failed, retry until a fresh reset timestamp arrives.
      const delay = at <= Date.now() ? 15_000 : at - Date.now() + 20;
      timer = setTimeout(async () => {
        try { await refresh(); } finally { if (!cancelled) schedule(); }
      }, delay);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh, resetAt]);
}
