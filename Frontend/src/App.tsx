import { lazy, Suspense, useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { Toast } from './components/Toast';
import { Billing } from './screens/Billing';
import { Login } from './screens/Login';
import { usePos } from './store';
import { canViewScreen } from './lib/permissions';
import { motion, AnimatePresence, screenFade } from './components/motion';
import { Spinner } from './components/motion';

/*
 * ── Why most screens are lazy, and two are not ─────────────────────────────
 * Every screen used to be a static import, so one bundle carried all of them:
 * a cashier who only ever opens Billing still downloaded Reports, Payroll and
 * the printer settings before the till could take an order. On a phone over
 * restaurant wifi that is the difference the staff actually feel.
 *
 * Billing and Login stay eager on purpose. Login is the first paint, and
 * putting a spinner in front of it would trade a real delay for a visible one.
 * Billing is both the most-used screen in a POS and the fallback below when a
 * permission check fails, so it has to be resolvable synchronously.
 */
const Dashboard = lazy(() => import('./screens/Dashboard').then((m) => ({ default: m.Dashboard })));
const Customers = lazy(() => import('./screens/Customers').then((m) => ({ default: m.Customers })));
const Employees = lazy(() => import('./screens/Employees').then((m) => ({ default: m.Employees })));
const Kitchen = lazy(() => import('./screens/Kitchen').then((m) => ({ default: m.Kitchen })));
const MenuManagement = lazy(() =>
  import('./screens/MenuManagement').then((m) => ({ default: m.MenuManagement })),
);
const PrinterSettings = lazy(() =>
  import('./screens/PrinterSettings').then((m) => ({ default: m.PrinterSettings })),
);
const Reports = lazy(() => import('./screens/Reports').then((m) => ({ default: m.Reports })));
const TableManagement = lazy(() =>
  import('./screens/TableManagement').then((m) => ({ default: m.TableManagement })),
);

const SCREENS = {
  dashboard: Dashboard,
  billing: Billing,
  menu: MenuManagement,
  tables: TableManagement,
  kitchen: Kitchen,
  customers: Customers,
  reports: Reports,
  employees: Employees,
  printer: PrinterSettings,
} as const;

/**
 * Shown while a screen chunk is in flight.
 *
 * Sized to fill the pane rather than collapsing it: a zero-height fallback
 * would let the shell reflow for the moment the chunk loads, which reads as a
 * flicker on every first visit to a tab.
 */
function ScreenLoading() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Spinner size={22} />
    </div>
  );
}

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

  /*
   * `100dvh`, not `100vh`: on mobile Safari and Chrome the URL bar counts
   * toward `vh`, so a full-height app is cut off by exactly the height of the
   * browser chrome until the user scrolls. `dvh` tracks the visible area.
   *
   * The old `minHeight: 680` came off with it — it forced a scrollbar on any
   * phone in landscape and on a short laptop window, to protect a desktop
   * layout that no longer runs at those sizes.
   */
  return (
    <div
      style={{
        height: '100dvh',
        background: '#f2f0eb',
        overflow: 'hidden',
      }}
    >
      {state.authBooting ? (
        <Splash />
      ) : state.user ? (
        <AppShell>
          {/*
            Keyed on the active screen so switching tabs cross-fades rather
            than snapping. `mode="wait"` lets the outgoing screen finish before
            the next mounts — two full screens overlapping mid-fade looks like
            a glitch, and on a POS a glitch reads as a fault.

            Deliberately just opacity: sliding a whole till screen sideways is
            the kind of motion that stops being charming on the hundredth use.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={allowed ? state.active : 'no-access'}
              initial={screenFade.initial}
              animate={screenFade.animate}
              exit={screenFade.exit}
              transition={screenFade.transition}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              {allowed ? (
                <Suspense fallback={<ScreenLoading />}>
                  <Screen />
                </Suspense>
              ) : (
                <NoAccess />
              )}
            </motion.div>
          </AnimatePresence>
        </AppShell>
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
