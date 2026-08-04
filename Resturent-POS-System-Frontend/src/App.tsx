import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { Toast } from './components/Toast';
import { Billing } from './screens/Billing';
import { Customers } from './screens/Customers';
import { Dashboard } from './screens/Dashboard';
import { Kitchen } from './screens/Kitchen';
import { Login } from './screens/Login';
import { MenuManagement } from './screens/MenuManagement';
import { Reports } from './screens/Reports';
import { TableManagement } from './screens/TableManagement';
import { usePos } from './store';
import { canViewScreen } from './lib/permissions';

const SCREENS = {
  dashboard: Dashboard,
  billing: Billing,
  menu: MenuManagement,
  tables: TableManagement,
  kitchen: Kitchen,
  customers: Customers,
  reports: Reports,
} as const;

export function App() {
  const { state, actions } = usePos();

  /**
   * Second line of defence behind the sidebar filter. `active` can also come
   * from restored localStorage, so it is re-checked here rather than trusting
   * that the only way to reach a screen is by clicking a nav row.
   *
   * The real enforcement is server-side — these screens will simply receive
   * 403s once they call the API in Phases 5-10. This just avoids rendering a
   * screen that can only fail.
   */
  const allowed = state.user ? canViewScreen(state.user.permissions, state.active) : false;
  const Screen = (allowed ? SCREENS[state.active] : undefined) ?? Billing;

  /**
   * Trade the httpOnly refresh cookie for an access token on load, so a page
   * reload does not sign the terminal out mid-shift. The access token lives
   * only in memory (see src/lib/api.ts), so this runs on every boot.
   */
  useEffect(() => {
    void actions.bootstrapAuth();
    // Once, on mount. `actions` is stable for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Load server-owned collections once a session exists.
   *
   * Keyed on the user id rather than a boolean so switching terminals between
   * staff — a PIN logout and a different PIN in — refetches rather than
   * leaving the previous cashier's view on screen. Each loader is permission-
   * aware by way of the API: a kitchen staffer's menu request simply 403s and
   * lands in that screen's error state, which is the correct outcome.
   */
  const userId = state.user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    void actions.loadMenu();
    void actions.loadTables();
    void actions.loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div style={{ height: '100vh', minHeight: 680, background: '#f2f0eb', overflow: 'hidden' }}>
      {state.authBooting ? (
        <Splash />
      ) : state.user ? (
        <AppShell>{allowed ? <Screen /> : <NoAccess />}</AppShell>
      ) : (
        <Login />
      )}
      <Toast />
    </div>
  );
}

/**
 * Rendered if a screen is somehow reached without the permission for it.
 * Should be unreachable in normal use — the nav omits those entries and the
 * store lands sessions on a permitted screen — so seeing this means a guard
 * upstream was bypassed.
 */
function NoAccess() {
  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: '#1E3932' }}>
        You don’t have access to this screen
      </h1>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
        Ask an administrator if you think this is a mistake.
      </p>
    </main>
  );
}

/**
 * Shown for the one round-trip it takes to restore a session. Without it the
 * login screen flashes on every reload for an already-signed-in terminal.
 */
function Splash() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '3px solid rgba(0,117,74,0.18)',
          borderTopColor: '#00754A',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
        Restoring session…
      </span>
    </div>
  );
}
