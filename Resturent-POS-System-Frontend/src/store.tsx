import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { KDS_COLS, NAV } from './data/seed';
import * as menuApi from './lib/menuApi';
import * as ordersApi from './lib/ordersApi';
import type { Order } from './lib/ordersApi';
import * as tablesApi from './lib/tablesApi';
import * as kitchenApi from './lib/kitchenApi';
import * as dashboardApi from './lib/dashboardApi';
import * as customersApi from './lib/customersApi';
import * as reportsApi from './lib/reportsApi';
import type { DailyReport, ExpenseRow, MonthlyReport, PnlReport } from './lib/reportsApi';
import type { DashboardData } from './lib/dashboardApi';
import { ApiError } from './lib/api';
import type {
  CartLine,
  Category,
  Customer,
  ExpenseCategory,
  MenuItem,
  OrderType,
  ScreenId,
  Table,
  TableStatus,
  Ticket,
} from './data/types';
import {
  loginAdmin,
  loginStaff,
  logout as apiLogout,
  restoreSession,
  loginErrorMessage,
  type SessionUser,
} from './lib/auth';
import { canViewScreen, defaultScreen } from './lib/permissions';

const SHELL_KEY = 'pos.shell.v1';

/**
 * Sentinel for the billing grid's "no category filter". A real category id can
 * never collide with it — ObjectIds are 24 hex characters.
 */
export const SHOW_ALL = '*all*';

/**
 * Turn a failed request into something worth showing a cashier mid-shift.
 *
 * 403 is deliberately not "something went wrong": it means the terminal is
 * signed in as someone without that permission, and saying so saves a support
 * call. 409 is the compare-and-swap losing a race, which the server's own
 * message already describes better than we could.
 */
function describe(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.isForbidden) return 'Your role does not allow that.';
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    return err.message || fallback;
  }
  return fallback;
}

export const CONFIG = {
  restaurantName: 'Kimche Restora',
  terminalLabel: 'Terminal 1 · Front counter',
  orderNumber: 20,
  pinLength: 4,
  showTaxRow: true,
  showDemoHint: true,
};

export type Modal =
  | { kind: 'cat'; mode: 'add' | 'edit'; target: string | null }
  | { kind: 'item'; mode: 'add' | 'edit'; target: string | null }
  | { kind: 'del'; delKind: 'cat' | 'item'; target: string }
  // Edit only. Customers are created at the till, so there is no add mode —
  // and `target` is non-null, which removes the "editing nothing" case.
  | { kind: 'cust'; mode: 'edit'; target: string }
  | { kind: 'exp' }
  | { kind: 'table'; mode: 'add' | 'edit'; target: string | null };

export interface ItemDraft {
  name: string;
  price: string;
  /** Category id. */
  cat: string;
  desc: string;
  /** Preview URL only — either the stored Cloudinary URL or a local data URL. */
  img: string;
  /**
   * The file to upload, kept alongside the preview. A data URL cannot be sent
   * as multipart, so the original File has to survive until save.
   */
  file: File | null;
  available: boolean;
  color: string;
}

export interface TableDraft {
  name: string;
  /** Kept as text so a half-typed value does not become NaN mid-edit. */
  seats: string;
  zone: string;
}

export interface CustomerDraft {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

export interface ExpenseDraft {
  date: string;
  cat: ExpenseCategory;
  desc: string;
  amt: string;
}

export type TablePanel = 'summary' | 'transfer' | 'merge' | 'split';

interface State {
  user: SessionUser | null;
  mode: 'pin' | 'password';
  pin: string;
  /**
   * The authenticated staff member, shown on the confirmation badge.
   *
   * Previously this was resolved locally by matching the typed PIN against a
   * bundled staff list. It is now only ever populated by a SUCCESSFUL login
   * response — the server will not tell anyone who owns a PIN without first
   * authenticating it, since that would turn the keypad into a name lookup.
   */
  match: SessionUser | null;
  loginError: string;
  shaking: boolean;
  email: string;
  password: string;
  /** A login request is in flight — disables the keypad and the sign-in button. */
  authPending: boolean;
  /** Restoring a session on boot; the app shows nothing until this settles. */
  authBooting: boolean;

  collapsed: boolean;
  active: ScreenId;
  hover: string;
  toast: string;
  tick: number;

  cat: string;
  query: string;
  /** Customer name. Auto-filled from the phone lookup when the number is known. */
  customer: string;
  /**
   * The phone number is the identity — it is what the lookup matches on and
   * what the server keys the customer record by. The name is a label hung off
   * it, which is why the field order on screen is phone first.
   */
  customerPhone: string;
  /** Set when the phone matched an existing record, so the UI can say so. */
  customerKnown: boolean;
  customerLookupPending: boolean;
  cart: CartLine[];
  discountMode: 'flat' | 'pct';
  discountValue: string;
  sendOpen: boolean;
  /**
   * Dine-in, takeaway or delivery. Drives whether a table is asked for at all:
   * the server refuses a dine-in order with no table AND refuses a table on
   * anything else, so this is not merely cosmetic.
   */
  orderType: OrderType;
  /** Table id, not name — the create-order call needs the id. Dine-in only. */
  orderTable: string | null;
  /**
   * The bill once it has been opened on the server. Until this is set the cart
   * is a local draft and nothing has been committed; once it is set the order
   * exists, a kitchen ticket has been printed, and the only remaining step is
   * settling it.
   */
  activeOrder: Order | null;
  checkoutPending: boolean;

  items: MenuItem[];
  cats: Category[];
  selCat: string;
  itemQuery: string;
  hoverCat: string;
  modal: Modal | null;
  draft: ItemDraft;
  menuLoading: boolean;
  menuError: string;

  tables: Table[];
  zone: string;
  selTable: string | null;
  panel: TablePanel;
  splitCount: number;
  splitMap: Record<number, number>;
  evenSplit: boolean;
  tablesLoading: boolean;
  tablesError: string;
  /**
   * Zone names in use, from the server rather than a hardcoded list — an admin
   * can invent a zone, and a table filed under one the filter does not know
   * about would simply be invisible.
   */
  zones: string[];
  /** Status filter on the floor grid. 'all' rather than null so it reads as a choice. */
  tableStatus: 'all' | TableStatus;
  tableDraft: TableDraft;
  tableError: string;
  /**
   * The open bill for whichever table is selected. Fetched on demand because
   * the tables endpoint returns a total and a line count, not the lines — the
   * floor view does not need them and shipping them to every terminal on every
   * poll would be the bulk of the payload.
   */
  tableOrder: Order | null;
  tableOrderLoading: boolean;

  tickets: Ticket[];
  kdsType: string;
  kdsFocus: string | null;
  kdsLoading: boolean;
  kdsError: string;

  dash: DashboardData | null;
  dashLoading: boolean;
  dashError: string;
  /** The order open in the detail drawer, fetched in full by id. */
  viewOrder: Order | null;
  viewOrderLoading: boolean;
  /** Id of the order awaiting delete confirmation. */
  deleteOrderId: string | null;
  deleteOrderReason: string;
  deleteOrderError: string;

  customers: Customer[];
  custQuery: string;
  selCust: string | null;
  openOrder: number | null;
  custDraft: CustomerDraft;
  custError: string;
  custLoading: boolean;
  custLoadError: string;

  repTab: 'daily' | 'monthly' | 'expenses' | 'pnl';
  repDate: string;
  repMonth: string;
  /**
   * One slot per tab rather than a single `report` union. Switching back to a
   * tab you were just on should show what was there, not a spinner, and a
   * shared slot would make each tab clobber the last.
   */
  daily: DailyReport | null;
  monthly: MonthlyReport | null;
  pnl: PnlReport | null;
  expenses: ExpenseRow[];
  expenseTotal: number;
  repLoading: boolean;
  repError: string;
  expDesc: boolean;
  expDraft: ExpenseDraft;
  expError: string;
}

const createInitialState = (): State => {
  return {
    user: null,
    mode: 'pin',
    pin: '',
    match: null,
    loginError: '',
    shaking: false,
    email: '',
    password: '',
    authPending: false,
    authBooting: true,

    collapsed: false,
    active: 'billing',
    hover: '',
    toast: '',
    tick: 0,

    cat: SHOW_ALL,
    query: '',
    customer: '',
    customerPhone: '',
    customerKnown: false,
    customerLookupPending: false,
    // Starts empty. A cart pre-filled from demo data looked like a bill in
    // progress that nobody had rung up.
    cart: [],
    discountMode: 'flat',
    discountValue: '0',
    sendOpen: false,
    orderType: 'dine-in',
    orderTable: null,
    activeOrder: null,
    checkoutPending: false,

    // Server-owned collections all start empty and are filled by the loaders
    // below. `null` error means "nothing has gone wrong", not "not loaded" —
    // the *Loading flags carry that.
    items: [],
    cats: [],
    selCat: '',
    itemQuery: '',
    hoverCat: '',
    modal: null,
    draft: {
      name: '',
      price: '',
      cat: '',
      desc: '',
      img: '',
      file: null,
      available: true,
      color: '#00754A',
    },
    menuLoading: false,
    menuError: '',

    tables: [],
    zone: 'All',
    selTable: null,
    panel: 'summary',
    splitCount: 2,
    splitMap: {},
    evenSplit: false,
    tablesLoading: false,
    tablesError: '',
    zones: [],
    tableStatus: 'all',
    tableDraft: { name: '', seats: '4', zone: '' },
    tableError: '',
    tableOrder: null,
    tableOrderLoading: false,

    tickets: [],
    kdsType: 'All',
    kdsFocus: null,
    kdsLoading: false,
    kdsError: '',

    dash: null,
    dashLoading: false,
    dashError: '',
    viewOrder: null,
    viewOrderLoading: false,
    deleteOrderId: null,
    deleteOrderReason: '',
    deleteOrderError: '',

    customers: [],
    custQuery: '',
    selCust: null,
    openOrder: null,
    custDraft: { name: '', phone: '', email: '', notes: '' },
    custError: '',
    custLoading: false,
    custLoadError: '',

    repTab: 'daily',
    // Today and this month, resolved at boot. The old fixed dates meant the
    // screen opened on a day that had no data the moment the demo aged.
    repDate: new Date().toISOString().slice(0, 10),
    repMonth: new Date().toISOString().slice(0, 7),
    daily: null,
    monthly: null,
    pnl: null,
    expenses: [],
    expenseTotal: 0,
    repLoading: false,
    repError: '',
    expDesc: true,
    expDraft: {
      date: new Date().toISOString().slice(0, 10),
      cat: 'Ingredients',
      desc: '',
      amt: '',
    },
    expError: '',
  };
};

/**
 * Where a session should land.
 *
 * The last-used screen is restored from localStorage, but a signed-in kitchen
 * staffer whose previous session ended on `billing` must not be dropped onto a
 * screen they cannot open. Falls back to the first screen their permissions
 * allow.
 */
function landingScreen(user: SessionUser | null): Partial<State> {
  if (!user) return {};
  const current = readSavedScreen();
  const target =
    current && canViewScreen(user.permissions, current)
      ? current
      : defaultScreen(user.permissions);
  return { active: target };
}

function readSavedScreen(): ScreenId | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SHELL_KEY) ?? 'null');
    return NAV.some((n) => n.id === saved?.active) ? (saved.active as ScreenId) : null;
  } catch {
    return null;
  }
}

function usePosState() {
  const [state, setState] = useState<State>(createInitialState);
  // Actions read the live state through this mirror so they can branch on it and
  // fire toasts without doing side effects inside a setState updater.
  const ref = useRef(state);
  ref.current = state;

  const toastTimer = useRef<number | undefined>(undefined);
  const shakeOn = useRef<number | undefined>(undefined);
  const shakeOff = useRef<number | undefined>(undefined);

  // Phone lookup is debounced and single-flight. Typing a ten-digit number
  // must not become ten requests against a PII endpoint that is deliberately
  // rate-limited — that would trip the limiter during ordinary use.
  const lookupTimer = useRef<number | undefined>(undefined);
  const lookupAbort = useRef<AbortController | undefined>(undefined);

  const patch = useCallback((next: Partial<State>) => {
    ref.current = { ...ref.current, ...next };
    setState(ref.current);
  }, []);

  const flash = useCallback(
    (toast: string) => {
      window.clearTimeout(toastTimer.current);
      patch({ toast });
      toastTimer.current = window.setTimeout(() => patch({ toast: '' }), 2600);
    },
    [patch],
  );

  /**
   * Look the number up, once the cashier stops typing.
   *
   * Fires only at 6+ digits — the shortest number the server will accept —
   * because querying on two digits is both useless and exactly the shape of a
   * prefix-walk the endpoint is built to refuse.
   */
  const scheduleLookup = useCallback(
    (phone: string) => {
      window.clearTimeout(lookupTimer.current);
      lookupAbort.current?.abort();

      const digits = phone.replace(/\D/g, '');
      if (digits.length < 6) return patch({ customerLookupPending: false });

      lookupTimer.current = window.setTimeout(() => {
        const controller = new AbortController();
        lookupAbort.current = controller;
        patch({ customerLookupPending: true });

        void customersApi
          .lookupByPhone(phone, controller.signal)
          .then((match) => {
            // The number may have changed again while this was in flight.
            if (ref.current.customerPhone !== phone) return;
            patch({
              customerLookupPending: false,
              customerKnown: match.found,
              // Only overwrite the name on a hit. Clearing it on a miss would
              // wipe what the cashier is part-way through typing for a new
              // customer.
              ...(match.found ? { customer: match.name ?? '' } : {}),
            });
          })
          .catch(() => {
            // A failed lookup is not a failed sale — the cashier can still type
            // the name. Silent by design; a toast here would fire on every
            // aborted keystroke.
            if (ref.current.customerPhone === phone) patch({ customerLookupPending: false });
          });
      }, 350);
    },
    [patch],
  );

  const shell = useCallback(
    (next: Partial<Pick<State, 'collapsed' | 'active'>>) => {
      patch(next);
      try {
        localStorage.setItem(
          SHELL_KEY,
          JSON.stringify({ collapsed: ref.current.collapsed, active: ref.current.active }),
        );
      } catch {
        /* storage is best-effort */
      }
    },
    [patch],
  );

  const shakeNow = useCallback(() => {
    window.clearTimeout(shakeOn.current);
    window.clearTimeout(shakeOff.current);
    patch({ shaking: false });
    shakeOn.current = window.setTimeout(() => patch({ shaking: true }), 20);
    shakeOff.current = window.setTimeout(() => patch({ shaking: false }), 480);
  }, [patch]);

  // Restore the sidebar choice and last screen, then keep elapsed timers moving.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SHELL_KEY) ?? 'null');
      if (saved) {
        patch({
          collapsed:
            typeof saved.collapsed === 'boolean' ? saved.collapsed : ref.current.collapsed,
          active: NAV.some((n) => n.id === saved.active) ? saved.active : ref.current.active,
        });
      }
    } catch {
      /* corrupt or unavailable storage just falls back to defaults */
    }
    const timer = window.setInterval(() => patch({ tick: ref.current.tick + 1 }), 30000);
    return () => window.clearInterval(timer);
  }, [patch]);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(shakeOn.current);
      window.clearTimeout(shakeOff.current);
    },
    [],
  );

  const actions = useMemo(() => {
    const setDraft = (p: Partial<ItemDraft>) => patch({ draft: { ...ref.current.draft, ...p } });
    const setCustDraft = (p: Partial<CustomerDraft>) =>
      patch({ custDraft: { ...ref.current.custDraft, ...p }, custError: '' });
    const setExpDraft = (p: Partial<ExpenseDraft>) =>
      patch({ expDraft: { ...ref.current.expDraft, ...p }, expError: '' });

    // Named rather than returned inline so the handlers that recover from a
    // conflict can refetch by calling their sibling loaders.
    const actions = {
      patch,
      flash,
      shell,
      setDraft,
      setCustDraft,
      setExpDraft,

      /**
       * PIN keypad.
       *
       * The completed PIN is sent to the server, which is the only party that
       * can say whether it is valid. On success the response carries the staff
       * member, which populates the confirmation badge; on failure the message
       * is whatever the server chose to reveal, which is deliberately vague.
       */
      pressKey: async (key: string) => {
        const s = ref.current;
        if (s.authPending) return;

        if (key === 'clear') return patch({ pin: '', match: null, loginError: '' });
        if (key === 'back')
          return patch({ pin: s.pin.slice(0, -1), match: null, loginError: '' });
        if (s.match) return;

        const pin = (s.pin + key).slice(0, CONFIG.pinLength);
        if (pin.length < CONFIG.pinLength) return patch({ pin, loginError: '' });

        patch({ pin, loginError: '', authPending: true });

        try {
          const user = await loginStaff(pin);
          patch({ match: user, authPending: false, loginError: '' });
        } catch (err) {
          patch({
            loginError: loginErrorMessage(err, 'Incorrect PIN'),
            pin: '',
            match: null,
            authPending: false,
          });
          shakeNow();
        }
      },

      /**
       * Dismiss the badge and enter the app. Authentication already happened
       * in pressKey — this is the confirmation step the design calls for, not
       * a second credential check.
       */
      confirmPin: () => {
        const { match } = ref.current;
        if (match) patch({ user: match, pin: '', match: null, ...landingScreen(match) });
      },

      signIn: async () => {
        const { email, password, authPending } = ref.current;
        if (authPending) return;

        patch({ authPending: true, loginError: '' });

        try {
          const user = await loginAdmin(email, password);
          patch({
            user,
            loginError: '',
            password: '',
            authPending: false,
            ...landingScreen(user),
          });
        } catch (err) {
          patch({
            loginError: loginErrorMessage(err, 'Incorrect email or password'),
            password: '',
            authPending: false,
          });
          shakeNow();
        }
      },

      /**
       * Clear local state immediately, then tell the server.
       *
       * Order matters for how this feels: the screen returns to the login
       * keypad at once rather than hanging on a network call. The server-side
       * revoke is what actually ends the session, and it still runs.
       */
      logout: () => {
        patch({
          user: null,
          mode: 'pin',
          pin: '',
          match: null,
          email: '',
          password: '',
          loginError: '',
          authPending: false,
          sendOpen: false,
          toast: '',
        });
        void apiLogout();
      },

      /** Boot-time session restore, driven by the httpOnly refresh cookie. */
      bootstrapAuth: async () => {
        try {
          const user = await restoreSession();
          patch({ user, authBooting: false, ...landingScreen(user) });
        } catch {
          patch({ user: null, authBooting: false });
        }
      },

      addToCart: (id: string) => {
        const { cart } = ref.current;
        patch({
          cart: cart.some((l) => l.id === id)
            ? cart.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l))
            : [...cart, { id, qty: 1, note: '', noteOpen: false }],
        });
      },

      bumpQty: (id: string, delta: number) =>
        patch({
          cart: ref.current.cart
            .map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l))
            .filter((l) => l.qty > 0),
        }),

      patchLine: (id: string, next: Partial<CartLine>) =>
        patch({ cart: ref.current.cart.map((l) => (l.id === id ? { ...l, ...next } : l)) }),

      removeLine: (id: string) =>
        patch({ cart: ref.current.cart.filter((l) => l.id !== id) }),

      /**
       * Switch order type. Clearing the table when leaving dine-in is not
       * housekeeping — the server refuses a table on takeaway or delivery, so
       * a leftover id would come back as "Only dine-in orders may be attached
       * to a table", which reads as a bug rather than as our own stale state.
       */
      setOrderType: (orderType: OrderType) =>
        patch({
          orderType,
          orderTable: orderType === 'dine-in' ? ref.current.orderTable : null,
        }),

      setCustomerPhone: (customerPhone: string) => {
        // Editing the number invalidates whatever name it resolved to. Leaving
        // the previous customer's name sitting there while the digits change
        // is how a bill ends up attached to the wrong person.
        patch({ customerPhone, customerKnown: false });
        scheduleLookup(customerPhone);
      },

      /** Manual override, for a genuine correction to a stored name. */
      setCustomerName: (customer: string) => patch({ customer }),

      /**
       * Open the bill.
       *
       * Creates the order and its kitchen ticket in one server-side
       * transaction, then applies the discount as a second call because the
       * discount endpoint is the one with the cashier ceiling and the manager
       * override on it. The client sends item ids and quantities only — every
       * total on the returned order is the server's own arithmetic, which is
       * why `activeOrder` replaces the locally computed figures the moment it
       * arrives.
       */
      generateBill: async () => {
        const s = ref.current;
        if (s.checkoutPending || s.activeOrder) return;
        if (s.cart.length === 0) return;

        patch({ checkoutPending: true });
        try {
          const { order } = await ordersApi.createOrder({
            type: s.orderType,
            tableId: s.orderType === 'dine-in' ? (s.orderTable ?? undefined) : undefined,
            // The server keys the customer off the phone and creates or
            // revives the record inside the same transaction as the order, so
            // there is no window where a customer exists for a sale that
            // failed. The name is sent only when it is new information — for a
            // known number the server ignores it anyway.
            customer: s.customerPhone.trim()
              ? {
                  phone: s.customerPhone.trim(),
                  ...(s.customerKnown ? {} : { name: s.customer.trim() || undefined }),
                }
              : undefined,
            items: s.cart.map((l) => ({ menuItemId: l.id, qty: l.qty, note: l.note })),
          });

          const value = parseFloat(s.discountValue) || 0;
          const withDiscount =
            value > 0
              ? await ordersApi.setDiscount(order.id, {
                  type: s.discountMode === 'pct' ? 'percent' : 'fixed',
                  value: s.discountValue.trim(),
                })
              : order;

          patch({ activeOrder: withDiscount, checkoutPending: false });
          flash(`Bill #${withDiscount.orderNo} opened`);

          // The floor and the board both changed: the table is now seated and
          // a ticket exists.
          void actions.loadTables();
          void actions.loadBoard();
        } catch (err) {
          patch({ checkoutPending: false });
          // A discount above the ceiling comes back 403 with the server's own
          // wording, which says more than a generic failure would.
          flash(describe(err, 'Could not open the bill.'));
        }
      },

      /** Settle an open bill. */
      payBill: async (paymentMethod: ordersApi.PaymentMethod) => {
        const s = ref.current;
        if (!s.activeOrder || s.checkoutPending) return;

        patch({ checkoutPending: true });
        try {
          const paid = await ordersApi.payOrder(s.activeOrder.id, { paymentMethod });
          patch({
            activeOrder: null,
            checkoutPending: false,
            cart: [],
            discountValue: '0',
            discountMode: 'flat',
            customer: '',
            customerPhone: '',
            customerKnown: false,
            orderTable: null,
            sendOpen: false,
          });
          flash(`Bill #${paid.orderNo} settled — ${paymentMethod}`);
          void actions.loadTables();
        } catch (err) {
          patch({ checkoutPending: false });
          flash(describe(err, 'Could not take that payment.'));
        }
      },

      /**
       * Void an open bill. The reason is mandatory server-side: an unexplained
       * void is indistinguishable in the audit log from theft.
       */
      voidBill: async (reason: string) => {
        const s = ref.current;
        if (!s.activeOrder || s.checkoutPending) return;

        patch({ checkoutPending: true });
        try {
          const voided = await ordersApi.voidOrder(s.activeOrder.id, { reason });
          patch({
            activeOrder: null,
            checkoutPending: false,
            cart: [],
            discountValue: '0',
            customer: '',
            customerPhone: '',
            customerKnown: false,
            orderTable: null,
          });
          flash(`Bill #${voided.orderNo} voided`);
          void actions.loadTables();
          void actions.loadBoard();
        } catch (err) {
          patch({ checkoutPending: false });
          flash(describe(err, 'Could not void that bill.'));
        }
      },

      /** Abandon an unopened draft. Touches nothing server-side. */
      clearCart: () =>
        patch({
          cart: [],
          discountValue: '0',
          customer: '',
          customerPhone: '',
          customerKnown: false,
          orderTable: null,
        }),

      /** Load the menu. Categories and items together — the grid needs both. */
      loadMenu: async () => {
        patch({ menuLoading: true, menuError: '' });
        try {
          const [cats, items] = await Promise.all([
            menuApi.listCategories(),
            menuApi.listItems({ includeInactive: false }),
          ]);
          patch({
            cats,
            items,
            // Keep the selection if it survived the reload, otherwise fall to
            // the first category rather than leaving the screen on a category
            // that no longer exists.
            selCat: cats.some((c) => c.id === ref.current.selCat)
              ? ref.current.selCat
              : (cats[0]?.id ?? ''),
            menuLoading: false,
          });
        } catch (err) {
          patch({ menuLoading: false, menuError: describe(err, 'Could not load the menu.') });
        }
      },

      openCatModal: (cat: Category | null) =>
        patch({
          modal: { kind: 'cat', mode: cat ? 'edit' : 'add', target: cat ? cat.id : null },
          draft: {
            ...ref.current.draft,
            name: cat ? cat.name : '',
            color: cat ? cat.color : '#00754A',
          },
        }),

      openItemModal: (item: MenuItem | null) =>
        patch({
          modal: { kind: 'item', mode: item ? 'edit' : 'add', target: item ? item.id : null },
          draft: {
            name: item ? item.name : '',
            price: item ? String(item.price) : '',
            cat: item ? item.cat : ref.current.selCat,
            desc: item?.desc ?? '',
            img: item ? item.img : '',
            file: null,
            available: item ? item.available : true,
            color: '#00754A',
          },
        }),

      openDeleteModal: (delKind: 'cat' | 'item', target: string) =>
        patch({ modal: { kind: 'del', delKind, target } }),

      closeModal: () => patch({ modal: null }),

      saveCat: async () => {
        const s = ref.current;
        if (s.modal?.kind !== 'cat') return;
        const name = s.draft.name.trim();
        if (!name) return;

        try {
          if (s.modal.mode === 'add') {
            const cat = await menuApi.createCategory({ name, color: s.draft.color });
            patch({ cats: [...s.cats, cat], selCat: cat.id, modal: null });
            return flash(`Category "${name}" added`);
          }

          const id = s.modal.target;
          if (!id) return;
          const cat = await menuApi.updateCategory(id, { name, color: s.draft.color });
          // Items reference the category by id, so a rename needs no fixups —
          // that is the whole reason `cat` stopped being a name.
          patch({ cats: s.cats.map((c) => (c.id === id ? cat : c)), modal: null });
          flash('Category updated');
        } catch (err) {
          patch({ modal: null });
          flash(describe(err, 'Could not save the category.'));
        }
      },

      saveItem: async () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'item') return;
        const name = s.draft.name.trim();
        if (!name) return;

        // The server takes major units as text and does its own conversion, so
        // the typed string is forwarded rather than parsed into a float here.
        const payload = {
          name,
          price: s.draft.price.trim(),
          category: s.draft.cat || s.selCat,
          description: s.draft.desc,
          available: s.draft.available,
          image: s.draft.file ?? null,
        };

        try {
          if (modal.mode === 'add') {
            const item = await menuApi.createItem(payload);
            patch({ items: [...s.items, item], selCat: item.cat, modal: null });
            return flash(`"${name}" added to the menu`);
          }

          if (!modal.target) return;
          const item = await menuApi.updateItem(modal.target, payload);
          patch({
            items: s.items.map((i) => (i.id === item.id ? item : i)),
            modal: null,
          });
          flash(`"${name}" updated`);
        } catch (err) {
          patch({ modal: null });
          flash(describe(err, 'Could not save the item.'));
        }
      },

      confirmDelete: async () => {
        const s = ref.current;
        if (s.modal?.kind !== 'del') return;
        const { delKind, target } = s.modal;

        try {
          if (delKind === 'cat') {
            // Refused server-side while live items still reference it, so the
            // local list is never pruned on an assumption.
            await menuApi.deleteCategory(target);
            const rest = s.cats.filter((c) => c.id !== target);
            const doomed = s.items.filter((i) => i.cat === target).map((i) => i.id);
            patch({
              cats: rest,
              items: s.items.filter((i) => i.cat !== target),
              cart: s.cart.filter((l) => !doomed.includes(l.id)),
              selCat: rest.length ? rest[0].id : '',
              modal: null,
            });
            return flash('Category removed');
          }

          /*
           * Try the permanent delete first and fall back to the soft one.
           *
           * The client cannot know whether an item has order history without
           * asking, and asking would be a second round trip whose answer could
           * be stale by the time the delete lands. Letting the server decide
           * means the check and the deletion happen in the same request: a 409
           * is not a failure here, it is the server saying "this one has
           * history, keep the row".
           */
          let purged = true;
          try {
            await menuApi.purgeItem(target);
          } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
              purged = false;
              await menuApi.deleteItem(target);
            } else {
              throw err;
            }
          }

          patch({
            items: s.items.filter((i) => i.id !== target),
            cart: s.cart.filter((l) => l.id !== target),
            modal: null,
          });
          flash(
            purged
              ? 'Item deleted permanently'
              : 'Item removed — the record was kept because it appears on past orders',
          );
        } catch (err) {
          patch({ modal: null });
          flash(describe(err, 'Could not delete that.'));
        }
      },

      /**
       * The stock toggle. Optimistic, because a cashier flipping "sold out"
       * mid-rush should see it move immediately — but reverted on failure, so
       * the screen never disagrees with the server about what is sellable.
       */
      toggleAvailable: async (id: string) => {
        const before = ref.current.items;
        const target = before.find((i) => i.id === id);
        if (!target) return;

        patch({
          items: before.map((i) => (i.id === id ? { ...i, available: !i.available } : i)),
        });

        try {
          const item = await menuApi.setAvailability(id, !target.available);
          patch({ items: ref.current.items.map((i) => (i.id === id ? item : i)) });
        } catch (err) {
          patch({ items: before });
          flash(describe(err, 'Could not change availability.'));
        }
      },

      pickImage: (file: File) => {
        // The data URL is for the preview; the File itself is what gets
        // uploaded. Keeping only the data URL would mean re-encoding a
        // multi-megabyte image into JSON on save.
        const reader = new FileReader();
        reader.onload = () => setDraft({ img: String(reader.result), file });
        reader.readAsDataURL(file);
      },

      startOrderAt: (table: Table) => {
        shell({ active: 'billing' });
        patch({ orderTable: table.id, selTable: null });
        flash(`New order started on ${table.name}`);
      },

      openTable: (table: Table) => {
        if (table.status === 'occupied') {
          patch({
            selTable: table.id,
            panel: 'summary',
            splitMap: {},
            evenSplit: false,
            splitCount: 2,
            tableOrder: null,
          });
          return void actions.loadTableOrder(table);
        }
        if (table.status === 'available') {
          shell({ active: 'billing' });
          patch({ orderTable: table.id, selTable: null });
          return flash(`New order started on ${table.name}`);
        }
        patch({ selTable: table.id, panel: 'summary', tableOrder: null });
      },

      /** Pull the bill behind a seated table so the panel can itemise it. */
      loadTableOrder: async (table: Table) => {
        if (!table.orderId) return patch({ tableOrder: null });
        patch({ tableOrderLoading: true });
        try {
          const order = await ordersApi.getOrder(table.orderId);
          patch({ tableOrder: order, tableOrderLoading: false });
        } catch (err) {
          patch({ tableOrder: null, tableOrderLoading: false });
          flash(describe(err, 'Could not load that bill.'));
        }
      },

      closePanel: () => patch({ selTable: null, panel: 'summary', tableOrder: null }),

      loadTables: async () => {
        patch({ tablesLoading: true, tablesError: '' });
        try {
          const [tables, zones] = await Promise.all([
            tablesApi.listTables(),
            tablesApi.listZones(),
          ]);
          patch({ tables, zones, tablesLoading: false });
        } catch (err) {
          patch({ tablesLoading: false, tablesError: describe(err, 'Could not load the floor.') });
        }
      },

      openTableModal: (table: Table | null) =>
        patch({
          modal: { kind: 'table', mode: table ? 'edit' : 'add', target: table?.id ?? null },
          tableError: '',
          tableDraft: table
            ? { name: table.name, seats: String(table.seats), zone: table.zone }
            : {
                name: '',
                seats: '4',
                // Default to the zone being viewed — an admin adding tables is
                // almost always adding them where they are already looking.
                zone: ref.current.zone === 'All' ? (ref.current.zones[0] ?? '') : ref.current.zone,
              },
        }),

      setTableDraft: (p: Partial<TableDraft>) =>
        patch({ tableDraft: { ...ref.current.tableDraft, ...p }, tableError: '' }),

      saveTable: async () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'table') return;

        const name = s.tableDraft.name.trim();
        const zone = s.tableDraft.zone.trim();
        const seats = Number(s.tableDraft.seats);

        // Checked here so the admin sees it without a round trip; the server
        // enforces the same bounds regardless, and its answer is the one that
        // decides.
        if (!name) return patch({ tableError: 'Give the table a name' });
        if (!zone) return patch({ tableError: 'Give the table a zone' });
        if (!Number.isInteger(seats) || seats < 1 || seats > 50) {
          return patch({ tableError: 'Seats must be a whole number between 1 and 50' });
        }

        try {
          if (modal.mode === 'add') {
            await tablesApi.createTable({ name, seats, zone });
            flash(`Table ${name} added`);
          } else {
            if (!modal.target) return;
            await tablesApi.updateTable(modal.target, { name, seats, zone });
            flash(`Table ${name} updated`);
          }
          patch({ modal: null });
          // Refetch rather than patching in place: a new zone changes the
          // filter row, and the server uppercases table names.
          void actions.loadTables();
        } catch (err) {
          // Held open with the message inline — a duplicate name, or an
          // occupied table being reconfigured, both come back as a 409 the
          // admin can act on without retyping the form.
          patch({ tableError: describe(err, 'Could not save that table.') });
        }
      },

      /**
       * Remove a table. Soft on the server, and refused while it holds an open
       * bill or another table is merged into it — so a 409 here is information,
       * not a failure to work around.
       */
      deleteTable: async (id: string) => {
        const s = ref.current;
        try {
          await tablesApi.deleteTable(id);
          patch({
            tables: s.tables.filter((t) => t.id !== id),
            selTable: s.selTable === id ? null : s.selTable,
            modal: null,
          });
          flash('Table removed');
        } catch (err) {
          flash(describe(err, 'Could not remove that table.'));
        }
      },

      /**
       * Transfer a party. The server claims the destination before releasing
       * the source, so on a 409 nothing moved and a refetch is the honest
       * response — patching local state would invent a floor plan that the
       * database disagrees with.
       */
      transferTable: async (destId: string) => {
        const s = ref.current;
        const src = s.tables.find((t) => t.id === s.selTable);
        if (!src) return;

        try {
          const { source, target } = await tablesApi.transferTable(src.id, destId);
          patch({
            tables: s.tables.map((t) =>
              t.id === source.id ? source : t.id === target.id ? target : t,
            ),
            selTable: destId,
            panel: 'summary',
          });
          flash(`${src.name} transferred to ${target.name}`);
        } catch (err) {
          flash(describe(err, 'Could not transfer that table.'));
          void actions.loadTables();
        }
      },

      mergeTable: async (otherId: string) => {
        const s = ref.current;
        const src = s.tables.find((t) => t.id === s.selTable);
        if (!src) return;

        try {
          await tablesApi.mergeTables(src.id, otherId);
          await actions.loadTables();
          patch({ panel: 'summary' });
          const other = ref.current.tables.find((t) => t.id === otherId);
          flash(`${src.name} and ${other?.name ?? 'that table'} now share one bill`);
        } catch (err) {
          flash(describe(err, 'Could not merge those tables.'));
        }
      },

      assignSplit: (row: number, bill: number) =>
        patch({ splitMap: { ...ref.current.splitMap, [row]: bill } }),

      loadBoard: async () => {
        patch({ kdsLoading: true, kdsError: '' });
        try {
          const { columns } = await kitchenApi.getBoard();
          // The board arrives grouped; the screen renders a flat list and
          // buckets by status itself, so flatten back in placedAt order.
          const tickets = KDS_COLS.flatMap((col) => columns[col.id] ?? []);
          patch({ tickets, kdsLoading: false });
        } catch (err) {
          patch({ kdsLoading: false, kdsError: describe(err, 'Could not load the board.') });
        }
      },

      /**
       * Move a ticket one column right. The target status is the server's to
       * decide — it reads its own transition map — so nothing here computes
       * the next state beyond labelling the toast.
       */
      advanceTicket: async (id: string) => {
        const s = ref.current;
        const ticket = s.tickets.find((t) => t.id === id);
        if (!ticket?.nextStatus) return;

        try {
          const updated = await kitchenApi.advanceTicket(id);
          patch({ tickets: s.tickets.map((t) => (t.id === id ? updated : t)) });
          flash(`Order #${updated.no} → ${KDS_COLS.find((c) => c.id === updated.status)?.label}`);
        } catch (err) {
          flash(describe(err, 'Could not move that ticket.'));
          void actions.loadBoard();
        }
      },

      recallTicket: async (id: string) => {
        const s = ref.current;
        try {
          const updated = await kitchenApi.recallTicket(id);
          patch({ tickets: s.tickets.map((t) => (t.id === id ? updated : t)) });
          flash(`Order #${updated.no} recalled`);
        } catch (err) {
          flash(describe(err, 'Could not recall that ticket.'));
        }
      },

      goPending: () => {
        shell({ active: 'kitchen' });
        patch({ kdsType: 'All', kdsFocus: 'pending' });
      },

      loadDashboard: async () => {
        patch({ dashLoading: true, dashError: '' });
        try {
          const dash = await dashboardApi.getDashboard();
          patch({ dash, dashLoading: false });
        } catch (err) {
          patch({ dashLoading: false, dashError: describe(err, 'Could not load the dashboard.') });
        }
      },

      /**
       * Open an order's detail. Fetched by id rather than reused from the
       * dashboard row: that row is a summary with no line items, and it was
       * assembled whenever the dashboard last loaded, which may have been
       * several sales ago.
       */
      viewOrderDetail: async (id: string) => {
        patch({ viewOrder: null, viewOrderLoading: true });
        try {
          const order = await ordersApi.getOrder(id);
          patch({ viewOrder: order, viewOrderLoading: false });
        } catch (err) {
          patch({ viewOrderLoading: false });
          flash(describe(err, 'Could not load that order.'));
        }
      },

      closeOrderDetail: () =>
        patch({
          viewOrder: null,
          viewOrderLoading: false,
          deleteOrderId: null,
          deleteOrderReason: '',
          deleteOrderError: '',
        }),

      askDeleteOrder: (id: string) =>
        patch({ deleteOrderId: id, deleteOrderReason: '', deleteOrderError: '' }),

      cancelDeleteOrder: () =>
        patch({ deleteOrderId: null, deleteOrderReason: '', deleteOrderError: '' }),

      /**
       * Permanently delete an order.
       *
       * The reason length is checked here purely so the admin gets the message
       * before the round trip — the server enforces it regardless, and that is
       * the check that counts.
       */
      confirmDeleteOrder: async () => {
        const s = ref.current;
        const id = s.deleteOrderId;
        if (!id) return;

        const reason = s.deleteOrderReason.trim();
        if (reason.length < 10) {
          return patch({
            deleteOrderError: 'Give a reason of at least 10 characters — this cannot be undone.',
          });
        }

        try {
          await ordersApi.deleteOrder(id, reason);
          patch({
            deleteOrderId: null,
            deleteOrderReason: '',
            deleteOrderError: '',
            viewOrder: null,
          });
          flash('Order permanently deleted');
          // Takings, the floor and the board can all have changed.
          void actions.loadDashboard();
          void actions.loadTables();
          void actions.loadBoard();
        } catch (err) {
          patch({ deleteOrderError: describe(err, 'Could not delete that order.') });
        }
      },

      loadCustomers: async () => {
        patch({ custLoading: true, custLoadError: '' });
        try {
          const customers = await customersApi.listCustomers({
            search: ref.current.custQuery.trim() || undefined,
          });
          patch({
            customers,
            custLoading: false,
            selCust: customers.some((c) => c.id === ref.current.selCust)
              ? ref.current.selCust
              : (customers[0]?.id ?? null),
          });
        } catch (err) {
          patch({ custLoading: false, custLoadError: describe(err, 'Could not load customers.') });
        }
      },

      /**
       * Edit only. Customers are created at the till now — there is no add
       * mode, because a record with no order behind it has no phone number
       * anyone has confirmed.
       */
      openCustModal: (customer: Customer) =>
        patch({
          modal: { kind: 'cust', mode: 'edit', target: customer.id },
          custError: '',
          custDraft: {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            notes: customer.notes,
          },
        }),

      saveCustomer: async () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'cust' || !modal.target) return;

        const name = s.custDraft.name.trim();
        const phone = s.custDraft.phone.trim();
        if (!name) return patch({ custError: 'Enter the customer’s name' });
        if (!phone) return patch({ custError: 'Phone number is required — it identifies them' });

        try {
          const updated = await customersApi.updateCustomer(modal.target, {
            name,
            phone,
            email: s.custDraft.email,
            notes: s.custDraft.notes,
          });
          patch({
            customers: s.customers.map((c) => (c.id === updated.id ? updated : c)),
            modal: null,
          });
          flash('Customer updated');
        } catch (err) {
          // Kept open with the message inline: a duplicate phone number is the
          // likely failure, and closing the form would lose what was typed.
          patch({ custError: describe(err, 'Could not save those details.') });
        }
      },

      /**
       * Remove a customer. Admin only — the route 403s for anyone else, and
       * the screen hides the control, but the server is what enforces it.
       */
      deleteCustomer: async (id: string) => {
        const s = ref.current;
        try {
          await customersApi.deleteCustomer(id);
          const rest = s.customers.filter((c) => c.id !== id);
          patch({
            customers: rest,
            selCust: s.selCust === id ? (rest[0]?.id ?? null) : s.selCust,
          });
          flash('Customer removed');
        } catch (err) {
          flash(describe(err, 'Could not remove that customer.'));
        }
      },

      orderForCustomer: (customer: Customer) => {
        shell({ active: 'billing' });
        patch({
          customer: customer.name,
          customerPhone: customer.phone,
          customerKnown: true,
          orderTable: null,
        });
        flash(`New order started for ${customer.name}`);
      },

      /**
       * Load whichever report the visible tab needs.
       *
       * Only one request per tab: the P&L and the monthly figures overlap, but
       * fetching both to render one would double the cost of every tab switch
       * for numbers nobody is looking at.
       */
      loadReport: async () => {
        const s = ref.current;
        patch({ repLoading: true, repError: '' });

        try {
          if (s.repTab === 'daily') {
            patch({ daily: await reportsApi.getDaily(s.repDate), repLoading: false });
          } else if (s.repTab === 'monthly') {
            patch({ monthly: await reportsApi.getMonthly(s.repMonth), repLoading: false });
          } else if (s.repTab === 'pnl') {
            // The P&L defaults to the selected month, so the two tabs agree
            // rather than quietly reporting different windows.
            const from = `${s.repMonth}-01`;
            const end = new Date(`${s.repMonth}-01T00:00:00`);
            end.setMonth(end.getMonth() + 1);
            end.setDate(0);
            patch({
              pnl: await reportsApi.getPnl({ from, to: end.toISOString().slice(0, 10) }),
              repLoading: false,
            });
          } else {
            const { expenses, totalAmount } = await reportsApi.listExpenses();
            patch({ expenses, expenseTotal: totalAmount, repLoading: false });
          }
        } catch (err) {
          patch({ repLoading: false, repError: describe(err, 'Could not load that report.') });
        }
      },

      saveExpense: async () => {
        const s = ref.current;
        const { date, cat, desc, amt } = s.expDraft;
        if (!desc.trim()) return patch({ expError: 'Add a short description' });
        if (!/^\d+(\.\d{1,2})?$/.test(amt.trim()) || Number(amt) <= 0) {
          return patch({ expError: 'Enter an amount greater than zero' });
        }

        try {
          await reportsApi.createExpense({
            date,
            category: cat,
            description: desc.trim(),
            amount: amt.trim(),
          });
          patch({ modal: null, expDraft: { date, cat, desc: '', amt: '' } });
          flash('Expense logged');
          // Refetch rather than appending: the list is sorted and paginated
          // server-side, and the P&L behind it has changed too.
          void actions.loadReport();
        } catch (err) {
          patch({ expError: describe(err, 'Could not save that expense.') });
        }
      },

      deleteExpense: async (id: string) => {
        try {
          await reportsApi.deleteExpense(id);
          flash('Expense removed');
          void actions.loadReport();
        } catch (err) {
          flash(describe(err, 'Could not remove that expense.'));
        }
      },
    };

    return actions;
  }, [patch, flash, shell, shakeNow]);

  return { state, actions };
}

export type PosActions = ReturnType<typeof usePosState>['actions'];

const PosContext = createContext<ReturnType<typeof usePosState> | null>(null);

export function PosProvider({ children }: { children: ReactNode }) {
  const store = usePosState();
  return <PosContext.Provider value={store}>{children}</PosContext.Provider>;
}

export function usePos() {
  const store = useContext(PosContext);
  if (!store) throw new Error('usePos must be used inside <PosProvider>');
  return store;
}
