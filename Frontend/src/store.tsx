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
import * as employeesApi from './lib/employeesApi';
import type { DailyReport, ExpenseRow, MonthlyReport, PnlReport } from './lib/reportsApi';
import type { DashboardData } from './lib/dashboardApi';
import type { PhoneSuggestion } from './lib/customersApi';
import { ApiError } from './lib/api';
import { money } from './lib/format';
import { MOBILE_MAX } from './lib/useViewport';
import * as settingsApi from './lib/settingsApi';
import * as printing from './lib/printing';
import type { BillData, KotData, PrinterSettings } from './lib/printing/types';
import { DEFAULT_PRINTER_SETTINGS } from './lib/printing/types';
import type {
  AttendanceRow,
  AttendanceStatus,
  CartLine,
  Category,
  Customer,
  Employee,
  ExpenseCategory,
  MenuItem,
  OrderType,
  PayrollRow,
  PayrollTotals,
  ScreenId,
  StaffRole,
  Table,
  TableStatus,
  Ticket,
} from './data/types';
import {
  loginGoogle,
  loginStaff,
  createRestaurant,
  fetchTerminalInfo,
  linkTerminal,
  logout as apiLogout,
  restoreSession,
  loginErrorMessage,
  isTerminalNotLinked,
  type SessionUser,
  type Restaurant,
  type Terminal,
  type Onboarding,
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
/**
 * Today, as the person at the till would write it.
 *
 * ── Why not toISOString().slice(0, 10) ─────────────────────────────────────
 * That converts to UTC first. In IST (+05:30) every moment after 18:30 local
 * belongs to the NEXT day in UTC — so from half six in the evening onward, a
 * report asking for "today" asked the server for yesterday and came back with
 * a day of zeros while the till had been busy for hours.
 *
 * The server records and queries days in ITS local time (reportController's
 * dayStart/dayEnd), so the client has to speak the same calendar. `en-CA`
 * formats as YYYY-MM-DD, which is the shape every endpoint expects.
 */
export const todayLocal = (): string => new Date().toLocaleDateString('en-CA');

/** The current month, same reasoning as todayLocal. */
export const thisMonthLocal = (): string => todayLocal().slice(0, 7);

/** A Date to its local YYYY-MM-DD, for values the user picked or stepped. */
export const toLocalDay = (d: Date): string => d.toLocaleDateString('en-CA');

function describe(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.isForbidden) return 'Your role does not allow that.';
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    return err.message || fallback;
  }
  return fallback;
}

/*
 * `restaurantName` and `terminalLabel` used to live here as constants.
 *
 * They are now per-restaurant data — read from the session for a signed-in
 * user, and from the terminal's own binding on the login screen, which is what
 * lets one deployment serve many restaurants without every till claiming to be
 * the same one. See state.restaurant and state.terminal.
 */
export const CONFIG = {
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
  | { kind: 'table'; mode: 'add' | 'edit'; target: string | null }
  | { kind: 'emp'; mode: 'add' | 'edit'; target: string | null }
  // Setting a PIN is its own dialog because it is its own endpoint — a
  // credential change should not be smuggled inside a name correction.
  | { kind: 'emppin'; target: string }
  // Separate from `del` rather than widening its `delKind`: this confirmation
  // carries a different warning ("deactivate instead"), and widening would
  // force every existing `del` consumer to handle a case it does not care
  // about.
  | { kind: 'empdel'; target: string }
  | { kind: 'pay'; employee: string; month: string };

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

/**
 * Numbers are held as TEXT, following the same rule as ItemDraft.price and
 * TableDraft.seats: a half-typed '31' on the way to '31000' must not become a
 * number mid-keystroke, and an empty field must not become NaN.
 */
export interface EmployeeDraft {
  name: string;
  role: StaffRole;
  pin: string;
  phone: string;
  joinedOn: string;
  salary: string;
  notes: string;
}

export interface PayrollDraft {
  bonus: string;
  deduction: string;
  notes: string;
}

/** Cashier is the common hire, so it is the default the form opens on. */
export const EMPTY_EMPLOYEE_DRAFT: EmployeeDraft = {
  name: '',
  role: 'cashier',
  pin: '',
  phone: '',
  joinedOn: '',
  salary: '',
  notes: '',
};

export interface ExpenseDraft {
  date: string;
  cat: ExpenseCategory;
  desc: string;
  amt: string;
}

export type TablePanel = 'summary' | 'transfer' | 'merge' | 'split';

interface State {
  user: SessionUser | null;
  /**
   * Which restaurant the session belongs to. Null before onboarding names one,
   * and on the login screen it holds whatever the terminal is linked to — so
   * the keypad can say where it is standing.
   */
  restaurant: Restaurant | null;
  /** The terminal this browser is linked to, when it is. */
  terminal: Terminal | null;
  /**
   * False when this browser has never been linked to a restaurant. The PIN
   * keypad is meaningless in that state — the server cannot resolve which
   * restaurant four digits belong to — so the login screen offers Google
   * sign-in and setup instead.
   */
  terminalLinked: boolean;
  /**
   * Set when a Google account has signed in but belongs to no restaurant. The
   * app renders the naming step instead of the till until it clears.
   */
  onboarding: Onboarding | null;
  /** The restaurant-name field on that step. */
  restaurantName: string;
  /** An administrator is naming this terminal, on the setup card. */
  terminalSetup: boolean;
  terminalName: string;
  mode: 'pin' | 'google';
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
  /**
   * Display-only. Holds the masked form ('9820•••22') when a customer was
   * picked from the suggestion list.
   *
   * Kept apart from `customerPhone` deliberately: that field is what gets sent
   * to the API and what the Generate Bill gate counts digits in, and a mask
   * satisfies that gate by coincidence of digit count rather than because a
   * real number is present. The server would reject the bullets anyway, so
   * mixing the two turns a display nicety into a failed sale.
   */
  customerPhoneMasked: string;
  /** Set when the phone matched an existing record, so the UI can say so. */
  customerKnown: boolean;
  customerLookupPending: boolean;
  /** The lookup budget is spent. Surfaced as a hint, never as a toast. */
  customerLookupThrottled: boolean;
  /**
   * Set only by picking a suggestion. The suggest endpoint returns an id and a
   * name but never a full number, so a picked customer is attached to the order
   * by id rather than by re-sending digits we were never given.
   */
  customerId: string | null;
  customerSuggestions: PhoneSuggestion[];
  suggestOpen: boolean;
  /** The dine-in table chooser, opened as an overlay rather than inline. */
  tablePickerOpen: boolean;
  cart: CartLine[];
  discountMode: 'flat' | 'pct';
  discountValue: string;
  /** Cart totals breakdown. The Total line itself is never collapsed. */
  totalsOpen: boolean;

  /**
   * The receipt just settled, kept so it can be shared after the cart clears.
   *
   * `payBill` wipes the order, the cart, the customer and the phone — which is
   * correct (the next customer must not inherit them) but leaves nothing to
   * show. The server cannot re-issue the URL either: it stores only a hash of
   * the link's token.
   *
   * So a SNAPSHOT is taken before the reset. It carries enough to confirm what
   * was just billed — who, how much, how many items — because a share panel
   * that shows only a number reads as though the details were never captured.
   */
  /**
   * The just-settled order, kept so a bill can still be printed after payment.
   *
   * `lastSettled` above carries an item COUNT, not the items — it exists to
   * drive the share panel. `payBill` clears the cart, the order and the table,
   * so without this snapshot a bill printed after payment would have no dishes
   * on it. Taken immediately before the reset.
   */
  lastPrintable: {
    order: ordersApi.Order;
    tableName: string;
    customerName: string;
  } | null;

  printerSettings: PrinterSettings;
  printerDraft: PrinterSettings;
  printerLoading: boolean;
  printerSaving: boolean;
  printerError: string;
  printTab: 'receipt' | 'business' | 'printers';
  printTransport: 'browser' | 'qz';
  qzAvailable: boolean;
  qzChecking: boolean;
  /** Printer names QZ reports for this machine. Empty under browser print. */
  qzPrinters: string[];
  /** A print is in flight — the buttons disable so nobody double-taps. */
  printBusy: boolean;

  lastSettled: {
    invoiceNo: string;
    url: string;
    /** Digits only, never the masked display form. Empty for a walk-in. */
    phone: string;
    customerName: string;
    itemCount: number;
    total: number;
    paymentMethod: string;
  } | null;
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
  /** A menu write is in flight. Item saves also upload an image. */
  menuSaving: boolean;
  menuError: string;

  tables: Table[];
  zone: string;
  selTable: string | null;
  panel: TablePanel;
  splitCount: number;
  splitMap: Record<number, number>;
  evenSplit: boolean;
  tablesLoading: boolean;
  /** Set while the table modal's save is in flight. Drives its spinner. */
  tblSaving: boolean;
  /**
   * The id of the single table currently being mutated from the floor —
   * delete, clear, transfer or merge — or null when none is.
   *
   * An id rather than a boolean because these controls are per-row: a shared
   * flag spins every tile on the floor when one of them is deleted, which is
   * exactly the bug this replaced.
   */
  tblBusyId: string | null;
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
  /**
   * Set while the delete is in flight. This one is irreversible and fans out
   * into three refetches, so a second click during the wait must not land.
   */
  deleteOrderBusy: boolean;

  customers: Customer[];
  custQuery: string;
  selCust: string | null;
  /** History is fetched per customer, so its own in-flight flag. */
  custHistoryLoading: boolean;
  openOrder: number | null;
  custDraft: CustomerDraft;
  custError: string;
  custLoading: boolean;
  /** Set while a customer save or delete is in flight. Drives the modal's spinner. */
  custSaving: boolean;
  custLoadError: string;

  // --- Employees -----------------------------------------------------------
  empTab: 'list' | 'attendance' | 'salary';
  employees: Employee[];
  empQuery: string;
  empShowInactive: boolean;
  empLoading: boolean;
  empLoadError: string;
  empDraft: EmployeeDraft;
  /** Form-blocking. Holds the modal open — this is where a duplicate PIN lands. */
  empError: string;
  empSaving: boolean;
  pinDraft: string;
  pinError: string;

  /** YYYY-MM-DD. A calendar key sent verbatim, never a timestamp. */
  attDate: string;
  attRows: AttendanceRow[];
  /** Unsaved marks, keyed by employee id. Empty until the admin touches a row. */
  attDraft: Record<string, { status: AttendanceStatus; notes: string }>;
  attLoading: boolean;
  attError: string;
  attSaving: boolean;

  /** Whose month the calendar is showing. Null when it is closed. */
  attCalEmployee: { id: string; name: string } | null;
  attCalMonth: string;
  /** 'YYYY-MM-DD' -> status. Days absent from the map were never marked. */
  attCalDays: Record<string, AttendanceStatus>;
  attCalLoading: boolean;
  attCalError: string;

  /** YYYY-MM. */
  payMonth: string;
  payRows: PayrollRow[];
  payTotals: PayrollTotals | null;
  payLoading: boolean;
  payError: string;
  payDraft: PayrollDraft;
  payFormError: string;

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
  /** Set while an expense save or delete is in flight. */
  expSaving: boolean;
}

const createInitialState = (): State => {
  return {
    user: null,
    restaurant: null,
    terminal: null,
    // Assume linked until the terminal check says otherwise, so a slow network
    // shows the familiar keypad rather than flashing a setup screen at staff
    // who are standing at a terminal that has worked for months.
    terminalLinked: true,
    onboarding: null,
    restaurantName: '',
    terminalSetup: false,
    terminalName: '',
    mode: 'pin',
    pin: '',
    match: null,
    loginError: '',
    shaking: false,
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
    customerPhoneMasked: '',
    customerKnown: false,
    customerLookupPending: false,
    customerLookupThrottled: false,
    customerId: null,
    customerSuggestions: [],
    suggestOpen: false,
    tablePickerOpen: false,
    // Starts empty. A cart pre-filled from demo data looked like a bill in
    // progress that nobody had rung up.
    cart: [],
    discountMode: 'flat',
    discountValue: '0',
    // Expanded by default — the breakdown is the normal state; collapsing
    // is what a cashier does when the item list needs the room.
    totalsOpen: true,
    lastSettled: null,
    lastPrintable: null,
    printerSettings: DEFAULT_PRINTER_SETTINGS,
    printerDraft: DEFAULT_PRINTER_SETTINGS,
    printerLoading: false,
    printerSaving: false,
    printerError: '',
    printTab: 'receipt',
    // Read from localStorage on boot: this describes the machine, and it has
    // to be right before the network is.
    printTransport: printing.readTransportPreference(),
    qzAvailable: false,
    qzChecking: false,
    qzPrinters: [],
    printBusy: false,
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
    menuSaving: false,
    menuError: '',

    tables: [],
    zone: 'All',
    selTable: null,
    panel: 'summary',
    splitCount: 2,
    splitMap: {},
    evenSplit: false,
    tablesLoading: false,
    tblSaving: false,
    tblBusyId: null,
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
    deleteOrderBusy: false,

    customers: [],
    custQuery: '',
    selCust: null,
    custHistoryLoading: false,
    openOrder: null,
    custDraft: { name: '', phone: '', email: '', notes: '' },
    custError: '',
    custLoading: false,
    custSaving: false,
    custLoadError: '',

    empTab: 'list',
    employees: [],
    empQuery: '',
    empShowInactive: false,
    empLoading: false,
    empLoadError: '',
    empDraft: EMPTY_EMPLOYEE_DRAFT,
    empError: '',
    empSaving: false,
    pinDraft: '',
    pinError: '',

    // Today and this month, resolved at boot — same reasoning as the report
    // dates below.
    attDate: todayLocal(),
    attRows: [],
    attDraft: {},
    attLoading: false,
    attError: '',
    attSaving: false,

    attCalEmployee: null,
    attCalMonth: thisMonthLocal(),
    attCalDays: {},
    attCalLoading: false,
    attCalError: '',

    payMonth: thisMonthLocal(),
    payRows: [],
    payTotals: null,
    payLoading: false,
    payError: '',
    payDraft: { bonus: '', deduction: '', notes: '' },
    payFormError: '',

    repTab: 'daily',
    // Today and this month, resolved at boot. The old fixed dates meant the
    // screen opened on a day that had no data the moment the demo aged.
    repDate: todayLocal(),
    repMonth: thisMonthLocal(),
    daily: null,
    monthly: null,
    pnl: null,
    expenses: [],
    expenseTotal: 0,
    repLoading: false,
    repError: '',
    expDesc: true,
    expDraft: {
      date: todayLocal(),
      cat: 'Ingredients',
      desc: '',
      amt: '',
    },
    expError: '',
    expSaving: false,
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

      // Below the suggestion floor there is nothing to show, and anything
      // already on screen is about a number that is no longer typed. Clearing
      // here is what stops a stale list hanging under an empty field.
      if (digits.length < 4) {
        return patch({
          customerLookupPending: false,
          customerSuggestions: [],
          suggestOpen: false,
        });
      }

      lookupTimer.current = window.setTimeout(() => {
        const controller = new AbortController();
        lookupAbort.current = controller;
        patch({ customerLookupPending: true });

        // Suggestions from 4 digits; the exact lookup only once the number is
        // COMPLETE. Both go out together so a finished number fills the name
        // AND stops offering alternatives in the same tick.
        //
        // The threshold is 10 rather than the server's 6-digit minimum because
        // every entry below it cost a second request that could not settle
        // anything — a half-typed number has no exact match to find. Halving
        // the request count is what keeps a lunch rush inside the lookup
        // budget, and a throttled lookup is indistinguishable from "no such
        // customer" at the counter.
        const wantExact = digits.length >= 10;

        void Promise.all([
          customersApi.suggestByPhone(phone, controller.signal),
          wantExact
            ? customersApi.lookupByPhone(phone, controller.signal)
            : Promise.resolve({ found: false } as const),
        ])
          .then(([suggestions, match]) => {
            // The number may have changed again while this was in flight.
            if (ref.current.customerPhone !== phone) return;
            patch({
              customerLookupPending: false,
              customerLookupThrottled: false,
              customerSuggestions: suggestions,
              // An exact hit answers the question — no reason to keep offering
              // near misses underneath the field.
              suggestOpen: !match.found && suggestions.length > 0,
              customerKnown: match.found,
              // Only overwrite the name on a hit. Clearing it on a miss would
              // wipe what the cashier is part-way through typing for a new
              // customer.
              ...(match.found ? { customer: match.name ?? '', customerId: null } : {}),
            });
          })
          .catch((err) => {
            // A failed lookup is not a failed sale — the cashier can still type
            // the name. Silent by design; a toast here would fire on every
            // aborted keystroke.
            //
            // A 429 is the exception worth naming. Throttled looks exactly like
            // "no match" from behind the counter, so staff retype a number that
            // was never going to answer. It is surfaced as a field hint, not a
            // toast: aborts are not 429s, so this cannot fire on typing.
            if (ref.current.customerPhone !== phone) return;
            patch({
              customerLookupPending: false,
              customerLookupThrottled: err instanceof ApiError && err.isRateLimited,
            });
          });
      }, 250);
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
    /**
     * Re-fetch the payroll month after a write.
     *
     * The totals row is a sum across every employee, so a single adjusted row
     * cannot be patched in without recomputing it locally — and a second place
     * deriving the same figure is how the two end up disagreeing. Cheaper to
     * ask the server, which already owns that arithmetic.
     */
    const reloadPayroll = async () => {
      try {
        const { rows, totals } = await employeesApi.getPayroll(ref.current.payMonth);
        patch({ payRows: rows, payTotals: totals });
      } catch {
        /* The write itself succeeded and has already been reported; a failed
           refresh should not turn that into an error message. */
      }
    };

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
          const session = await loginStaff(pin);
          patch({
            match: session.user,
            restaurant: session.restaurant,
            terminal: session.terminal,
            authPending: false,
            loginError: '',
          });
        } catch (err) {
          /*
           * An unlinked terminal is not a wrong PIN, and must not be shown as
           * one. Shaking the keypad at a cashier who typed correctly sends
           * them looking for a mistake they did not make; the honest answer is
           * that this machine was never set up, which needs an owner.
           */
          if (isTerminalNotLinked(err)) {
            patch({
              terminalLinked: false,
              mode: 'google',
              pin: '',
              match: null,
              authPending: false,
              loginError: '',
            });
            return;
          }

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

      /**
       * Google sign-in, for owners and administrators.
       *
       * `credential` is the ID token Google Identity Services hands the page.
       * It is not inspected here — the server verifies it against Google's
       * published keys, and a client-side opinion about it would be worth
       * nothing anyway.
       */
      signInWithGoogle: async (credential: string) => {
        if (ref.current.authPending) return;
        patch({ authPending: true, loginError: '' });

        try {
          const session = await loginGoogle(credential);

          /*
           * A real session that cannot reach anything yet.
           *
           * Deliberately does NOT call landingScreen: there is no restaurant,
           * so every screen behind the nav would fail its first request. The
           * app renders the naming step instead, and the server agrees — a
           * token with no restaurant can only reach /auth/me and /tenants.
           */
          if (session.onboarding) {
            patch({
              user: session.user,
              onboarding: session.onboarding,
              restaurantName: session.onboarding.suggestedName ?? '',
              authPending: false,
              loginError: '',
            });
            return;
          }

          patch({
            user: session.user,
            restaurant: session.restaurant,
            onboarding: null,
            authPending: false,
            loginError: '',
            ...landingScreen(session.user),
          });
        } catch (err) {
          patch({
            loginError: loginErrorMessage(err, 'Google sign-in was refused'),
            authPending: false,
          });
          shakeNow();
        }
      },

      setRestaurantName: (restaurantName: string) => patch({ restaurantName }),

      /** Name the restaurant, and become its administrator. */
      submitRestaurantName: async () => {
        const { restaurantName, authPending } = ref.current;
        const name = restaurantName.trim();
        if (authPending) return;
        if (name.length < 2) {
          return patch({ loginError: 'Enter a name with at least 2 characters' });
        }

        patch({ authPending: true, loginError: '' });

        try {
          const session = await createRestaurant(name);
          patch({
            user: session.user,
            restaurant: session.restaurant,
            onboarding: null,
            restaurantName: '',
            authPending: false,
            loginError: '',
            ...landingScreen(session.user),
          });
        } catch (err) {
          patch({
            loginError: loginErrorMessage(err, 'Could not create the restaurant'),
            authPending: false,
          });
        }
      },

      openTerminalSetup: () =>
        patch({
          terminalSetup: true,
          terminalName: ref.current.terminal?.name ?? 'Terminal 1',
          loginError: '',
        }),

      closeTerminalSetup: () => patch({ terminalSetup: false, loginError: '' }),

      setTerminalName: (terminalName: string) => patch({ terminalName }),

      /**
       * Link this browser to the administrator's restaurant.
       *
       * The token comes back as an httpOnly cookie, never in the response, so
       * there is nothing to store here — after this call the machine simply
       * starts presenting it, and staff PIN sign-in begins working.
       */
      linkThisTerminal: async () => {
        const { terminalName, authPending } = ref.current;
        const name = terminalName.trim();
        if (authPending) return;
        if (name.length < 2) {
          return patch({ loginError: 'Enter a name with at least 2 characters' });
        }

        patch({ authPending: true, loginError: '' });

        try {
          const terminal = await linkTerminal(name);
          patch({
            terminal,
            terminalLinked: true,
            terminalSetup: false,
            authPending: false,
            loginError: '',
            toast: `This terminal is now linked as “${terminal.name}”`,
          });
        } catch (err) {
          patch({
            loginError: loginErrorMessage(err, 'Could not link this terminal'),
            authPending: false,
          });
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
        /*
         * The terminal binding deliberately SURVIVES a logout.
         *
         * It is a property of the machine, not of whoever last used it —
         * clearing it would mean an owner had to re-link the till every time a
         * cashier finished a shift. `restaurant` is kept for the same reason:
         * the login screen names the restaurant this terminal belongs to.
         */
        const { terminal, terminalLinked, restaurant } = ref.current;
        patch({
          user: null,
          restaurant: terminalLinked ? restaurant : null,
          terminal,
          terminalLinked,
          onboarding: null,
          restaurantName: '',
          terminalSetup: false,
          mode: 'pin',
          pin: '',
          match: null,
          loginError: '',
          authPending: false,
          lastSettled: null,
          lastPrintable: null,
          toast: '',
        });
        void apiLogout();
      },

      /** Boot-time session restore, driven by the httpOnly refresh cookie. */
      bootstrapAuth: async () => {
        try {
          /*
           * Both at once: the session may not exist, and the terminal label is
           * needed either way — a signed-out machine still has to name its
           * restaurant on the keypad.
           */
          const [session, info] = await Promise.all([restoreSession(), fetchTerminalInfo()]);

          const terminalState = {
            terminalLinked: info.linked,
            terminal: info.terminal,
          };

          if (!session) {
            return patch({
              user: null,
              authBooting: false,
              ...terminalState,
              restaurant: info.restaurant
                ? { id: '', name: info.restaurant.name, slug: info.restaurant.slug }
                : null,
              // An unlinked machine cannot take a PIN, so open on the door
              // that still works.
              mode: info.linked ? 'pin' : 'google',
            });
          }

          // A restored session that never finished onboarding resumes there.
          if (session.onboarding) {
            return patch({
              user: session.user,
              onboarding: session.onboarding,
              restaurantName: session.onboarding.suggestedName ?? '',
              authBooting: false,
              ...terminalState,
            });
          }

          patch({
            user: session.user,
            restaurant: session.restaurant,
            onboarding: null,
            authBooting: false,
            ...terminalState,
            ...landingScreen(session.user),
          });
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
          // Choosing dine-in without a table is an unfinished choice — the
          // server refuses the order — so the chooser opens straight away
          // rather than waiting to be found.
          tablePickerOpen: orderType === 'dine-in' && !ref.current.orderTable,
        }),

      openTablePicker: () => patch({ tablePickerOpen: true }),
      closeTablePicker: () => patch({ tablePickerOpen: false }),

      chooseTable: (id: string | null) => patch({ orderTable: id, tablePickerOpen: false }),

      setCustomerPhone: (customerPhone: string) => {
        // Editing the number invalidates whatever name it resolved to, and any
        // customer picked from the list. Leaving either in place while the
        // digits change is how a bill ends up attached to the wrong person.
        // The masked display goes with them, for the same reason.
        patch({
          customerPhone,
          customerPhoneMasked: '',
          customerKnown: false,
          customerId: null,
        });
        scheduleLookup(customerPhone);
      },

      /**
       * Take a suggestion.
       *
       * Attaches by id, because the suggest endpoint never sends the digits —
       * it masks the middle so the customer list cannot be harvested by typing
       * prefixes. The mask goes into `customerPhoneMasked` for display only;
       * `customerPhone` stays empty, so nothing containing a bullet can reach
       * the API or be miscounted by the Generate Bill gate.
       */
      pickSuggestion: (s: PhoneSuggestion) =>
        patch({
          customerId: s.id,
          customer: s.name,
          customerPhoneMasked: s.phoneMasked,
          customerKnown: true,
          suggestOpen: false,
          customerSuggestions: [],
        }),

      /** Detach the picked customer and return the field to free typing. */
      clearPickedCustomer: () =>
        patch({
          customerId: null,
          customer: '',
          customerPhone: '',
          customerPhoneMasked: '',
          customerKnown: false,
          customerSuggestions: [],
          suggestOpen: false,
        }),

      closeSuggestions: () => patch({ suggestOpen: false }),

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
          const { order, table } = await ordersApi.createOrder({
            type: s.orderType,
            tableId: s.orderType === 'dine-in' ? (s.orderTable ?? undefined) : undefined,
            // Picked from the list: attach by id. The suggest endpoint never
            // returns a full number, so there are no digits to send back.
            customerId: s.customerId ?? undefined,
            // Otherwise the server keys off the phone and creates or revives
            // the record inside the same transaction as the order, so there is
            // no window where a customer exists for a sale that failed. The
            // schema refuses both fields at once, which is why this is an
            // either/or rather than two independent ifs.
            customer:
              !s.customerId && s.customerPhone.trim()
                ? {
                    phone: s.customerPhone.trim(),
                    ...(s.customerKnown ? {} : { name: s.customer.trim() || undefined }),
                  }
                : undefined,
            items: s.cart.map((l) => ({ menuItemId: l.id, qty: l.qty, note: l.note })),
            // Sent with the order rather than PATCHed onto it afterwards, so
            // the bill is never briefly persisted at the undiscounted total.
            // The server applies it inside the same transaction and runs the
            // same ceiling check the separate endpoint did.
            discount:
              (parseFloat(s.discountValue) || 0) > 0
                ? {
                    type: s.discountMode === 'pct' ? 'percent' : 'fixed',
                    value: s.discountValue.trim(),
                  }
                : undefined,
          });

          patch({
            activeOrder: order,
            checkoutPending: false,
            lastPrintable: null,
            /*
             * The floor is patched from the response, not refetched.
             *
             * This used to be loadTables() + loadBoard() — three more requests
             * (tables, zones, board) whose only job was to discover that the
             * table this response already describes is now occupied. The board
             * refetch was pure waste from here: only the Kitchen screen reads
             * `tickets`, and it has its own SSE stream that the server already
             * notified via announceNewTicket.
             */
            ...(table
              ? { tables: ref.current.tables.map((t) => (t.id === table.id ? table : t)) }
              : {}),
          });
          flash(`Bill #${order.orderNo} opened`);
        } catch (err) {
          patch({ checkoutPending: false });
          // A discount above the ceiling comes back 403 with the server's own
          // wording, which says more than a generic failure would.
          flash(describe(err, 'Could not open the bill.'));
        }
      },

      /** Settle an open bill. */
      /**
       * Hand the receipt to the customer over WhatsApp.
       *
       * ── Why wa.me and not an API ───────────────────────────────────────
       * The Business API costs money per conversation and needs an approved
       * template. `wa.me` is a plain deep link: it opens WhatsApp with the
       * message already typed, and the cashier taps send. Free, no account,
       * and the message comes from the restaurant's own number.
       *
       * The number must be digits only, with a country code, and must NEVER be
       * the masked display value — that contains bullet characters and would
       * open a chat with nobody. `payBill` captures the typed digits for
       * exactly this reason.
       */
      shareOnWhatsApp: () => {
        const settled = ref.current.lastSettled;
        if (!settled) return;
        const restaurantName = ref.current.restaurant?.name ?? 'us';

        /**
         * Strip everything that is not a digit — including the bullet
         * characters of a masked number, which is what used to reach wa.me and
         * made WhatsApp answer "please enter mobile number". Anything left
         * that is too short to dial is reported here, in words the cashier can
         * act on, rather than being handed to WhatsApp to complain about.
         */
        const digits = (settled.phone ?? '').replace(/\D/g, '');
        if (digits.length < 10) {
          return flash(
            digits.length === 0
              ? 'No phone number on this bill — use Copy link instead.'
              : 'That phone number is too short to send to. Use Copy link instead.',
          );
        }

        // A bare 10-digit Indian number needs the country code prefixed, or
        // WhatsApp resolves it against whatever locale the phone happens to be
        // in and opens a chat with a stranger.
        const msisdn = digits.length === 10 ? `91${digits}` : digits;

        // The amount goes in the message, not just behind the link: a bare URL
        // from an unknown number reads like spam, and a customer should be able
        // to see what it is for before deciding to tap it.
        const message =
          `Thank you for visiting ${restaurantName}.\n\n` +
          `Invoice ${settled.invoiceNo}\n` +
          `Total: ${money(settled.total)}\n\n` +
          `View or download your bill:\n${settled.url}`;

        window.open(
          `https://wa.me/${msisdn}?text=${encodeURIComponent(message)}`,
          '_blank',
          'noopener,noreferrer',
        );

        /**
         * Handing the receipt over is the end of this panel's job, so it goes
         * away — rather than sitting on a shared screen with the last
         * customer's name and total until the next bill happens to settle.
         *
         * Only the till's copy is cleared. The invoice and the link already
         * sent are untouched and keep working.
         */
        patch({ lastSettled: null });
      },

      /** The fallback: works with no phone number and no WhatsApp installed. */
      copyInvoiceLink: async () => {
        const settled = ref.current.lastSettled;
        if (!settled) return;

        try {
          await navigator.clipboard.writeText(settled.url);
          flash('Invoice link copied');
        } catch {
          // Clipboard access is refused outside a secure context, which a POS
          // on a plain-HTTP LAN address genuinely is. Show the link so it can
          // still be read out or typed — and KEEP the panel up, since a link
          // that has to be transcribed by hand has not been shared yet.
          return flash(settled.url);
        }

        patch({ lastSettled: null });
      },

      // ---------------------------------------------------------------------
      // Printing
      // ---------------------------------------------------------------------
      setPrintTab: (printTab: State['printTab']) => patch({ printTab }),

      setPrinterDraft: (p: Partial<PrinterSettings>) =>
        patch({ printerDraft: { ...ref.current.printerDraft, ...p }, printerError: '' }),

      loadPrinterSettings: async () => {
        patch({ printerLoading: true, printerError: '' });
        try {
          const settings = await settingsApi.getPrinterSettings();
          patch({ printerSettings: settings, printerDraft: settings, printerLoading: false });
        } catch (err) {
          patch({
            printerLoading: false,
            printerError: describe(err, 'Could not load the printer settings.'),
          });
        }
      },

      savePrinterSettings: async () => {
        const draft = ref.current.printerDraft;
        patch({ printerSaving: true, printerError: '' });
        try {
          // effective* are server-derived; sending them back would be rejected
          // by the strict schema.
          const { effectiveName, effectiveFooter, ...body } = draft;
          void effectiveName;
          void effectiveFooter;
          const settings = await settingsApi.updatePrinterSettings(body);
          patch({ printerSettings: settings, printerDraft: settings, printerSaving: false });
          flash('Printer settings saved');
        } catch (err) {
          patch({
            printerSaving: false,
            printerError: describe(err, 'Could not save those settings.'),
          });
        }
      },

      /** Per-terminal, so it is written to localStorage rather than the API. */
      setPrintTransport: (printTransport: 'browser' | 'qz') => {
        printing.writeTransportPreference(printTransport);
        patch({ printTransport });
        if (printTransport === 'qz') void actions.checkQz();
      },

      checkQz: async () => {
        patch({ qzChecking: true });
        printing.clearQzProbeCache();
        const qzAvailable = await printing.isQzAvailable();
        // Fetched in the same pass: a connected daemon that cannot name a
        // printer is exactly the state worth showing on the settings screen.
        const qzPrinters = qzAvailable ? await printing.listQzPrinters() : [];
        patch({ qzAvailable, qzPrinters, qzChecking: false });
      },

      printKot: async () => {
        const s = ref.current;
        const source = s.lastPrintable
          ? { order: s.lastPrintable.order, tableName: s.lastPrintable.tableName }
          : s.activeOrder
            ? {
                order: s.activeOrder,
                tableName: s.tables.find((t) => t.id === s.orderTable)?.name ?? '',
              }
            : null;
        if (!source || s.printBusy) return;

        const data: KotData = {
          orderNo: source.order.orderNo,
          // Mirrors ticketSource() on the server — what the expo needs to
          // route the ticket, and the only routing information a cook gets.
          source:
            source.order.type === 'dine-in' && source.tableName
              ? `Table ${source.tableName}`
              : source.order.type === 'takeaway'
                ? 'Takeaway'
                : 'Delivery',
          type: source.order.type,
          placedAt: new Date(source.order.createdAt),
          items: source.order.items.map((l) => ({ name: l.name, qty: l.qty, note: l.note })),
        };

        patch({ printBusy: true });
        try {
          const out = await printing.printKot(data, s.printerSettings);
          flash(
            out.degraded
              ? 'QZ Tray is not running — opened the browser print dialog instead'
              : 'Kitchen ticket sent',
          );
        } catch (err) {
          flash(describe(err, 'Could not print the kitchen ticket.'));
        } finally {
          patch({ printBusy: false });
        }
      },

      printBill: async () => {
        const s = ref.current;
        const source = s.lastPrintable
          ? s.lastPrintable
          : s.activeOrder
            ? {
                order: s.activeOrder,
                tableName: s.tables.find((t) => t.id === s.orderTable)?.name ?? '',
                customerName: s.customer.trim(),
              }
            : null;
        if (!source || s.printBusy) return;

        const settings = s.printerSettings;
        const o = source.order;
        const data: BillData = {
          invoiceNo: o.invoiceNo ?? `#${o.orderNo}`,
          orderNo: o.orderNo,
          business: {
            name: settings.effectiveName,
            address: settings.businessAddress,
            phone: settings.businessPhone,
            gstNumber: settings.gstNumber,
            footer: settings.effectiveFooter,
          },
          tableName: source.tableName || null,
          customerName: source.customerName || null,
          placedAt: new Date(o.createdAt),
          // Null while unpaid — the template then prints ** UNPAID **, which
          // is the honest thing to hand someone before they have paid.
          paidAt: o.paidAt ? new Date(o.paidAt) : null,
          paymentMethod: o.paymentMethod,
          items: o.items.map((l) => ({
            name: l.name,
            qty: l.qty,
            note: l.note,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          subtotal: o.subtotal,
          discount: o.discount,
          tax: o.tax,
          taxRate: o.taxRate,
          total: o.total,
        };

        patch({ printBusy: true });
        try {
          const out = await printing.printBill(data, settings);
          flash(
            out.degraded
              ? 'QZ Tray is not running — opened the browser print dialog instead'
              : 'Bill sent to the printer',
          );
        } catch (err) {
          flash(describe(err, 'Could not print the bill.'));
        } finally {
          patch({ printBusy: false });
        }
      },

      /**
       * A fixed sample through the CURRENT DRAFT settings.
       *
       * Draft, not saved: checking the paper size should not require
       * committing it first. The sample deliberately includes a name long
       * enough to wrap, a note, and a discount — the three things that break
       * a column layout.
       */
      printTestReceipt: async (job: 'kot' | 'bill') => {
        const settings = ref.current.printerDraft;
        const now = new Date();
        const items = [
          { name: 'Paneer Butter Masala', qty: 2, note: '', unitPrice: 320, lineTotal: 640 },
          { name: 'Garlic Naan with extra butter and coriander', qty: 3, note: 'No onion', unitPrice: 70, lineTotal: 210 },
          { name: 'Cold Drink', qty: 1, note: '', unitPrice: 60, lineTotal: 60 },
        ];

        patch({ printBusy: true });
        try {
          const out =
            job === 'kot'
              ? await printing.printKot(
                  { orderNo: 1042, source: 'Table T5', type: 'dine-in', placedAt: now, items },
                  settings,
                )
              : await printing.printBill(
                  {
                    invoiceNo: 'INV-20260807-1042',
                    orderNo: 1042,
                    business: {
                      name: settings.effectiveName,
                      address: settings.businessAddress,
                      phone: settings.businessPhone,
                      gstNumber: settings.gstNumber,
                      footer: settings.effectiveFooter,
                    },
                    tableName: 'T5',
                    customerName: 'Test Customer',
                    placedAt: now,
                    paidAt: now,
                    paymentMethod: 'cash',
                    items,
                    subtotal: 910,
                    discount: 50,
                    tax: 0,
                    taxRate: 0,
                    total: 860,
                  },
                  settings,
                );
          flash(out.degraded ? 'QZ Tray is not running — used the browser instead' : 'Test sent');
        } catch (err) {
          flash(describe(err, 'Could not print the test.'));
        } finally {
          patch({ printBusy: false });
        }
      },

      payBill: async (paymentMethod: ordersApi.PaymentMethod) => {
        const s = ref.current;
        if (!s.activeOrder || s.checkoutPending) return;

        /**
         * Snapshotted BEFORE the reset below clears every one of these.
         *
         * The phone is taken from `customerPhone`, never `customerPhoneMasked`
         * — the masked form is display text full of bullet characters and
         * would open a WhatsApp chat with nobody.
         */
        // Resolved before the reset clears `orderTable` — the paid order carries
        // a table id, and a receipt needs the name.
        const settledTableName = s.tables.find((t) => t.id === s.orderTable)?.name ?? '';
        const settled = {
          // Placeholder: the authoritative number comes back with the payment
          // response, since a customer attached by id was never typed here.
          phone: s.customerPhone.trim(),
          customerName: s.customer.trim(),
          itemCount: s.cart.reduce((sum, line) => sum + line.qty, 0),
          total: s.activeOrder.total,
        };

        patch({ checkoutPending: true });
        try {
          const { order: paid, invoice } = await ordersApi.payOrder(s.activeOrder.id, {
            paymentMethod,
          });
          patch({
            // The paid order itself, so a bill can still be printed once the
            // cart is gone. `lastSettled` holds a count, not the items.
            lastPrintable: {
              order: paid,
              tableName: settledTableName,
              customerName: settled.customerName,
            },
            lastSettled: invoice
              ? {
                  invoiceNo: invoice.invoiceNo,
                  url: invoice.url,
                  ...settled,
                  // Prefer the server's number. For a returning customer the
                  // till only ever held a masked form, which WhatsApp rejects
                  // with "please enter mobile number".
                  phone: invoice.customerPhone ?? settled.phone,
                  paymentMethod,
                }
              : null,
            activeOrder: null,
            checkoutPending: false,
            cart: [],
            discountValue: '0',
            discountMode: 'flat',
            customer: '',
            customerPhone: '',
            customerPhoneMasked: '',
            customerKnown: false,
            customerId: null,
            customerSuggestions: [],
            suggestOpen: false,
            orderTable: null,
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
            customerPhoneMasked: '',
            customerKnown: false,
            customerId: null,
            orderTable: null,
            lastSettled: null,
            lastPrintable: null,
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
          customerPhoneMasked: '',
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

        // The dialog already passes state.menuSaving to its save button; until
        // now nothing on this path ever set it, so the spinner never appeared.
        patch({ menuSaving: true });
        try {
          if (s.modal.mode === 'add') {
            const cat = await menuApi.createCategory({ name, color: s.draft.color });
            patch({ menuSaving: false, cats: [...s.cats, cat], selCat: cat.id, modal: null });
            return flash(`Category "${name}" added`);
          }

          const id = s.modal.target;
          if (!id) return patch({ menuSaving: false });
          const cat = await menuApi.updateCategory(id, { name, color: s.draft.color });
          // Items reference the category by id, so a rename needs no fixups —
          // that is the whole reason `cat` stopped being a name.
          patch({
            menuSaving: false,
            cats: s.cats.map((c) => (c.id === id ? cat : c)),
            modal: null,
          });
          flash('Category updated');
        } catch (err) {
          patch({ menuSaving: false, modal: null });
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

        patch({ menuSaving: true });
        try {
          if (modal.mode === 'add') {
            const item = await menuApi.createItem(payload);
            patch({ menuSaving: false, items: [...s.items, item], selCat: item.cat, modal: null });
            return flash(`"${name}" added to the menu`);
          }

          // Every exit clears the flag, including this early return — a
          // stuck `true` leaves the dialog disabled with no way out.
          if (!modal.target) return patch({ menuSaving: false });
          const item = await menuApi.updateItem(modal.target, payload);
          patch({
            menuSaving: false,
            items: s.items.map((i) => (i.id === item.id ? item : i)),
            modal: null,
          });
          flash(`"${name}" updated`);
        } catch (err) {
          patch({ menuSaving: false, modal: null });
          flash(describe(err, 'Could not save the item.'));
        }
      },

      confirmDelete: async () => {
        const s = ref.current;
        if (s.modal?.kind !== 'del') return;
        const { delKind, target } = s.modal;

        // Shares menuSaving with saveCat/saveItem: both drive the same modal
        // and cannot run at once, so a second flag would only be a second
        // thing to forget to clear. The item path can make two sequential
        // round trips (purge, then the soft fallback), which is exactly the
        // wait that looked like a dead button.
        patch({ menuSaving: true });
        try {
          if (delKind === 'cat') {
            // Refused server-side while live items still reference it, so the
            // local list is never pruned on an assumption.
            await menuApi.deleteCategory(target);
            const rest = s.cats.filter((c) => c.id !== target);
            const doomed = s.items.filter((i) => i.cat === target).map((i) => i.id);
            patch({
              menuSaving: false,
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
            menuSaving: false,
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
          patch({ menuSaving: false, modal: null });
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

      /**
       * Reload the floor.
       *
       * `withZones` was two separate requests until the server learned to
       * return both. Zones are asked for only when we do not have them yet:
       * TableManagement re-polls this every 15 seconds, and re-fetching a list
       * of zone names that changes when an admin adds a table — so, rarely —
       * is a request per poll spent confirming nothing moved.
       */
      loadTables: async (opts?: { withZones?: boolean }) => {
        // Default: only when we have none. Callers that just changed which
        // zones exist — saveTable, deleteTable — ask for them explicitly.
        const needZones = opts?.withZones ?? ref.current.zones.length === 0;
        patch({ tablesLoading: true, tablesError: '' });
        try {
          const { tables, zones } = await tablesApi.listTables({ withZones: needZones });
          patch({
            tables,
            ...(zones ? { zones } : {}),
            tablesLoading: false,
          });
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

        // Set after the validation guards above, all of which return without
        // touching the network — flagging before them would strand the flag.
        patch({ tblSaving: true });
        try {
          if (modal.mode === 'add') {
            await tablesApi.createTable({ name, seats, zone });
            flash(`Table ${name} added`);
          } else {
            if (!modal.target) return patch({ tblSaving: false });
            await tablesApi.updateTable(modal.target, { name, seats, zone });
            flash(`Table ${name} updated`);
          }
          patch({ tblSaving: false, modal: null });
          // Refetch rather than patching in place: a new zone changes the
          // filter row, and the server uppercases table names. withZones
          // because this is one of the two operations that can change which
          // zones exist at all.
          void actions.loadTables({ withZones: true });
        } catch (err) {
          // Held open with the message inline — a duplicate name, or an
          // occupied table being reconfigured, both come back as a 409 the
          // admin can act on without retyping the form.
          patch({ tblSaving: false, tableError: describe(err, 'Could not save that table.') });
        }
      },

      /**
       * Remove a table. Soft on the server, and refused while it holds an open
       * bill or another table is merged into it — so a 409 here is information,
       * not a failure to work around.
       */
      deleteTable: async (id: string) => {
        // Scoped to this id: the delete control lives on every tile, so a
        // shared boolean would spin the whole floor.
        patch({ tblBusyId: id });
        try {
          await tablesApi.deleteTable(id);
          // ref.current, not the pre-request `s` — see transferTable.
          patch({
            tblBusyId: null,
            tables: ref.current.tables.filter((t) => t.id !== id),
            selTable: ref.current.selTable === id ? null : ref.current.selTable,
            modal: null,
          });
          flash('Table removed');
          // Removing the last table in a zone removes the zone, so the filter
          // row has to be told. Fire-and-forget: the tile is already gone from
          // the patch above, so this only reconciles the zone list.
          void actions.loadTables({ withZones: true });
        } catch (err) {
          patch({ tblBusyId: null });
          flash(describe(err, 'Could not remove that table.'));
        }
      },

      /**
       * Transfer a party. The server claims the destination before releasing
       * the source, so on a 409 nothing moved and a refetch is the honest
       * response — patching local state would invent a floor plan that the
       * database disagrees with.
       */
      /**
       * Clear a settled table so the next party can be seated.
       *
       * Needed because paying a bill no longer frees the table: a party that
       * has paid is usually still sitting there, and a floor that turns green
       * on the card tap tells the host a table is free that is not. Somebody
       * has to say the table is actually empty, and this is where they say it.
       *
       * The server refuses while a bill is still open, so this cannot be used
       * to walk away from an unpaid tab.
       */
      releaseTable: async () => {
        const s = ref.current;
        const target = s.tables.find((t) => t.id === s.selTable);
        if (!target) return;

        patch({ tblBusyId: target.id });
        try {
          const table = await tablesApi.releaseTable(target.id);
          // ref.current, not the pre-request `s` — see transferTable.
          patch({
            tblBusyId: null,
            tables: ref.current.tables.map((t) => (t.id === table.id ? table : t)),
          });
          flash(`${target.name} is free`);
        } catch (err) {
          patch({ tblBusyId: null });
          flash(describe(err, 'Could not clear that table.'));
          void actions.loadTables();
        }
      },

      transferTable: async (destId: string) => {
        const s = ref.current;
        const src = s.tables.find((t) => t.id === s.selTable);
        if (!src) return;

        // Keyed to the destination, which is the row the host just tapped.
        patch({ tblBusyId: destId });
        try {
          const { source, target } = await tablesApi.transferTable(src.id, destId);
          // Rebuilt from ref.current, NOT from the `s` captured above: the
          // floor is live (the SSE stream and other terminals both write to
          // it), so mapping over a pre-request snapshot would silently revert
          // every table that changed while this request was in flight.
          patch({
            tblBusyId: null,
            tables: ref.current.tables.map((t) =>
              t.id === source.id ? source : t.id === target.id ? target : t,
            ),
            selTable: destId,
            panel: 'summary',
          });
          flash(`${src.name} transferred to ${target.name}`);
        } catch (err) {
          patch({ tblBusyId: null });
          flash(describe(err, 'Could not transfer that table.'));
          void actions.loadTables();
        }
      },

      mergeTable: async (otherId: string) => {
        const s = ref.current;
        const src = s.tables.find((t) => t.id === s.selTable);
        if (!src) return;

        // The slowest of the three: it waits on a full floor refetch before it
        // is done, so the wait here is the most visible one.
        patch({ tblBusyId: otherId });
        try {
          await tablesApi.mergeTables(src.id, otherId);
          await actions.loadTables();
          patch({ tblBusyId: null, panel: 'summary' });
          const other = ref.current.tables.find((t) => t.id === otherId);
          flash(`${src.name} and ${other?.name ?? 'that table'} now share one bill`);
        } catch (err) {
          patch({ tblBusyId: null });
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

        // Guard as well as flag: this deletes an order permanently, so a
        // double click must not send the request twice.
        if (s.deleteOrderBusy) return;
        patch({ deleteOrderBusy: true });
        try {
          await ordersApi.deleteOrder(id, reason);
          patch({
            deleteOrderBusy: false,
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
          patch({
            deleteOrderBusy: false,
            deleteOrderError: describe(err, 'Could not delete that order.'),
          });
        }
      },

      loadCustomers: async () => {
        patch({ custLoading: true, custLoadError: '' });
        try {
          const customers = await customersApi.listCustomers({
            search: ref.current.custQuery.trim() || undefined,
          });
          /*
           * Auto-select the first customer on desktop only.
           *
           * The two layouts read this field differently. Desktop shows list
           * and detail side by side, so an empty detail pane looks broken —
           * hence the fallback. Mobile shows ONE of them, choosing by whether
           * anything is selected, so the same fallback opens a customer
           * nobody tapped and hides the list behind a back button.
           *
           * Read directly rather than through useIsMobile: this is the store,
           * where hooks cannot run, and the value is only needed at the
           * moment the list lands.
           */
          const stillThere = customers.some((c) => c.id === ref.current.selCust);
          const isMobile =
            typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX;

          patch({
            customers,
            custLoading: false,
            selCust: stillThere
              ? ref.current.selCust
              : isMobile
                ? null
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

        // After the validation guards, which return before any request.
        patch({ custSaving: true });
        try {
          const updated = await customersApi.updateCustomer(modal.target, {
            name,
            phone,
            email: s.custDraft.email,
            notes: s.custDraft.notes,
          });
          patch({
            custSaving: false,
            customers: s.customers.map((c) => (c.id === updated.id ? updated : c)),
            modal: null,
          });
          flash('Customer updated');
        } catch (err) {
          // Kept open with the message inline: a duplicate phone number is the
          // likely failure, and closing the form would lose what was typed.
          patch({ custSaving: false, custError: describe(err, 'Could not save those details.') });
        }
      },

      /**
       * Remove a customer. Admin only — the route 403s for anyone else, and
       * the screen hides the control, but the server is what enforces it.
       */
      deleteCustomer: async (id: string) => {
        const s = ref.current;
        patch({ custSaving: true });
        try {
          await customersApi.deleteCustomer(id);
          const rest = s.customers.filter((c) => c.id !== id);
          patch({
            custSaving: false,
            customers: rest,
            selCust: s.selCust === id ? (rest[0]?.id ?? null) : s.selCust,
          });
          flash('Customer removed');
        } catch (err) {
          patch({ custSaving: false });
          flash(describe(err, 'Could not remove that customer.'));
        }
      },

      /**
       * Select a customer and pull their recent bills.
       *
       * History is NOT part of the list payload — a page of fifty customers
       * would mean fifty joins for orders nobody has asked to see yet. It is
       * fetched per selection instead, and cached on the record so flicking
       * between two customers does not refetch either.
       */
      selectCustomer: async (id: string) => {
        patch({ selCust: id, openOrder: null });

        const existing = ref.current.customers.find((c) => c.id === id);
        if (!existing || existing.history !== undefined) return;

        patch({ custHistoryLoading: true });
        try {
          const history = await customersApi.getCustomerHistory(id);
          patch({
            customers: ref.current.customers.map((c) => (c.id === id ? { ...c, history } : c)),
            custHistoryLoading: false,
          });
        } catch (err) {
          // The stats above are already on screen and still correct, so this
          // failure costs the order list and nothing else.
          patch({ custHistoryLoading: false });
          flash(describe(err, 'Could not load their order history.'));
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

      // ---------------------------------------------------------------------
      // Employees
      // ---------------------------------------------------------------------
      setEmpTab: (empTab: State['empTab']) => patch({ empTab }),
      setEmpQuery: (empQuery: string) => patch({ empQuery }),
      toggleEmpInactive: () => patch({ empShowInactive: !ref.current.empShowInactive }),

      loadEmployees: async () => {
        patch({ empLoading: true, empLoadError: '' });
        try {
          const employees = await employeesApi.listEmployees({
            includeInactive: ref.current.empShowInactive,
          });
          patch({ employees, empLoading: false });
        } catch (err) {
          patch({ empLoading: false, empLoadError: describe(err, 'Could not load the staff list.') });
        }
      },

      /** `null` opens the add form; an employee opens it seeded for editing. */
      openEmpModal: (employee: Employee | null) =>
        patch({
          modal: { kind: 'emp', mode: employee ? 'edit' : 'add', target: employee?.id ?? null },
          empError: '',
          empDraft: employee
            ? {
                name: employee.name,
                // An admin cannot be edited into a staff role by this form, but
                // the draft still has to hold a value the select can show.
                role: employee.role === 'kitchen_staff' ? 'kitchen_staff' : 'cashier',
                pin: '',
                phone: employee.phone,
                joinedOn: employee.joinedOn,
                salary: employee.monthlySalary ? String(employee.monthlySalary) : '',
                notes: employee.notes,
              }
            : EMPTY_EMPLOYEE_DRAFT,
        }),

      setEmpDraft: (p: Partial<EmployeeDraft>) =>
        patch({ empDraft: { ...ref.current.empDraft, ...p }, empError: '' }),

      saveEmployee: async () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'emp') return;

        const name = s.empDraft.name.trim();
        if (name.length < 2) return patch({ empError: 'Enter the employee’s name' });

        // Only checked when creating: an existing employee's PIN is changed
        // through its own dialog, so a blank field here means "leave it alone".
        if (modal.mode === 'add' && !/^\d{4}$/.test(s.empDraft.pin)) {
          return patch({ empError: 'Set a 4-digit PIN — it is how they sign in' });
        }

        const shared = {
          name,
          role: s.empDraft.role,
          phone: s.empDraft.phone.trim(),
          employmentNotes: s.empDraft.notes.trim(),
          // Sent as text; the server converts to minor units at its boundary.
          monthlySalary: s.empDraft.salary.trim() || '0',
          ...(s.empDraft.joinedOn ? { joinedOn: s.empDraft.joinedOn } : {}),
        };

        patch({ empSaving: true, empError: '' });
        try {
          if (modal.mode === 'add') {
            const employee = await employeesApi.createEmployee({ ...shared, pin: s.empDraft.pin });
            patch({
              employees: [...ref.current.employees, employee].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
              modal: null,
              empSaving: false,
            });
            return flash(`${employee.name} added`);
          }

          const employee = await employeesApi.updateEmployee(modal.target as string, shared);
          patch({
            employees: ref.current.employees.map((e) => (e.id === employee.id ? employee : e)),
            modal: null,
            empSaving: false,
          });
          flash(`${employee.name} updated`);
        } catch (err) {
          // Held open with the message inline. A duplicate PIN is the likely
          // failure and closing the form would lose everything already typed.
          patch({ empSaving: false, empError: describe(err, 'Could not save those details.') });
        }
      },

      openPinModal: (id: string) => patch({ modal: { kind: 'emppin', target: id }, pinDraft: '', pinError: '' }),
      setPinDraft: (pinDraft: string) =>
        patch({ pinDraft: pinDraft.replace(/\D/g, '').slice(0, 4), pinError: '' }),

      saveEmployeePin: async () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'emppin') return;
        if (!/^\d{4}$/.test(s.pinDraft)) return patch({ pinError: 'Enter exactly 4 digits' });

        patch({ empSaving: true, pinError: '' });
        try {
          await employeesApi.setEmployeePin(modal.target, s.pinDraft);
          patch({
            employees: ref.current.employees.map((e) =>
              e.id === modal.target ? { ...e, hasPin: true } : e,
            ),
            modal: null,
            pinDraft: '',
            empSaving: false,
          });
          flash('PIN updated — they sign in with it from now on');
        } catch (err) {
          // The duplicate-PIN 409 lands here, beside the field being retyped.
          patch({ empSaving: false, pinError: describe(err, 'Could not set that PIN.') });
        }
      },

      /**
       * Not optimistic, unlike the menu availability toggle. Deactivating an
       * account is a security action; showing it as done when it silently
       * failed is the wrong direction to be wrong in.
       */
      toggleEmployeeActive: async (id: string) => {
        const target = ref.current.employees.find((e) => e.id === id);
        if (!target) return;
        try {
          const employee = await employeesApi.setEmployeeActive(id, !target.isActive);
          const next = ref.current.employees.map((e) => (e.id === id ? employee : e));
          patch({
            // A reactivated employee disappears from a list filtered to active
            // staff only if we drop them; keep them and let the filter decide.
            employees: next,
          });
          flash(employee.isActive ? `${employee.name} reactivated` : `${employee.name} deactivated`);
        } catch (err) {
          flash(describe(err, 'Could not change that account.'));
        }
      },

      openEmpDelete: (id: string) => patch({ modal: { kind: 'empdel', target: id }, empError: '' }),

      deleteEmployee: async () => {
        const modal = ref.current.modal;
        if (modal?.kind !== 'empdel') return;

        patch({ empSaving: true, empError: '' });
        try {
          await employeesApi.deleteEmployee(modal.target);
          patch({
            employees: ref.current.employees.filter((e) => e.id !== modal.target),
            modal: null,
            empSaving: false,
          });
          flash('Employee removed');
        } catch (err) {
          // Expected for anyone who has worked a shift. The server's message
          // explains why and points at deactivation, so it is shown in place
          // rather than flashed and lost.
          patch({ empSaving: false, empError: describe(err, 'Could not remove that employee.') });
        }
      },

      // ---------------------------------------------------------------------
      // Attendance
      // ---------------------------------------------------------------------
      setAttDate: (attDate: string) => patch({ attDate, attDraft: {} }),

      loadAttendanceDay: async () => {
        patch({ attLoading: true, attError: '' });
        try {
          const { rows } = await employeesApi.getAttendanceDay(ref.current.attDate);
          // Draft is reset from the server, so switching days cannot carry an
          // unsaved mark onto the wrong date.
          patch({ attRows: rows, attDraft: {}, attLoading: false });
        } catch (err) {
          patch({ attLoading: false, attError: describe(err, 'Could not load attendance.') });
        }
      },

      setAttMark: (employeeId: string, status: AttendanceStatus) => {
        const current = ref.current;
        const existing =
          current.attDraft[employeeId] ??
          current.attRows.find((r) => r.employeeId === employeeId);
        patch({
          attDraft: {
            ...current.attDraft,
            [employeeId]: { status, notes: existing?.notes ?? '' },
          },
        });
      },

      setAttNote: (employeeId: string, notes: string) => {
        const current = ref.current;
        const row = current.attRows.find((r) => r.employeeId === employeeId);
        const status = current.attDraft[employeeId]?.status ?? row?.status;
        // A note without a status is not a mark, so there is nothing to stage.
        if (!status) return;
        patch({ attDraft: { ...current.attDraft, [employeeId]: { status, notes } } });
      },

      saveAttendanceDay: async () => {
        const s = ref.current;
        const entries = Object.entries(s.attDraft).map(([employee, mark]) => ({
          employee,
          status: mark.status,
          notes: mark.notes,
        }));
        if (entries.length === 0) return flash('Nothing to save');

        patch({ attSaving: true, attError: '' });
        try {
          await employeesApi.markAttendanceDay(s.attDate, entries);
          const { rows } = await employeesApi.getAttendanceDay(s.attDate);
          patch({ attRows: rows, attDraft: {}, attSaving: false });
          flash(`Attendance saved for ${entries.length} ${entries.length === 1 ? 'person' : 'people'}`);
        } catch (err) {
          patch({ attSaving: false, attError: describe(err, 'Could not save attendance.') });
        }
      },

      // ---------------------------------------------------------------------
      // Attendance calendar — one employee, one month at a glance
      // ---------------------------------------------------------------------
      openAttendanceCalendar: (id: string, name: string) => {
        // Opens on the month being marked, not on today: an admin catching up
        // on last month wants that month, and the day roster is already there.
        patch({
          attCalEmployee: { id, name },
          attCalMonth: ref.current.attDate.slice(0, 7),
          attCalDays: {},
          attCalError: '',
        });
      },

      closeAttendanceCalendar: () => patch({ attCalEmployee: null, attCalDays: {} }),

      /** Step a whole month. UTC arithmetic, to match how days are stored. */
      stepAttCalMonth: (delta: number) => {
        const [year, month] = ref.current.attCalMonth.split('-').map(Number);
        const moved = new Date(Date.UTC(year, month - 1 + delta, 1));
        patch({ attCalMonth: moved.toISOString().slice(0, 7), attCalDays: {} });
      },

      loadAttendanceCalendar: async () => {
        const { attCalEmployee, attCalMonth } = ref.current;
        if (!attCalEmployee) return;

        patch({ attCalLoading: true, attCalError: '' });
        try {
          const { days } = await employeesApi.getAttendanceMonth(attCalMonth, attCalEmployee.id);
          // The month may have been stepped again while this was in flight.
          if (ref.current.attCalMonth !== attCalMonth) return;
          patch({ attCalDays: days, attCalLoading: false });
        } catch (err) {
          patch({
            attCalLoading: false,
            attCalError: describe(err, 'Could not load that month.'),
          });
        }
      },

      // ---------------------------------------------------------------------
      // Payroll
      // ---------------------------------------------------------------------
      setPayMonth: (payMonth: string) => patch({ payMonth }),

      loadPayroll: async () => {
        patch({ payLoading: true, payError: '' });
        try {
          const { rows, totals } = await employeesApi.getPayroll(ref.current.payMonth);
          patch({ payRows: rows, payTotals: totals, payLoading: false });
        } catch (err) {
          patch({ payLoading: false, payError: describe(err, 'Could not load payroll.') });
        }
      },

      openPayModal: (employeeId: string) => {
        const row = ref.current.payRows.find((r) => r.employeeId === employeeId);
        patch({
          modal: { kind: 'pay', employee: employeeId, month: ref.current.payMonth },
          payFormError: '',
          payDraft: {
            bonus: row?.bonus ? String(row.bonus) : '',
            deduction: row?.deduction ? String(row.deduction) : '',
            notes: row?.notes ?? '',
          },
        });
      },

      setPayDraft: (p: Partial<PayrollDraft>) =>
        patch({ payDraft: { ...ref.current.payDraft, ...p }, payFormError: '' }),

      savePayAdjustment: async () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'pay') return;

        patch({ payFormError: '' });
        try {
          const row = await employeesApi.adjustPayroll(modal.employee, modal.month, {
            bonus: s.payDraft.bonus.trim() || '0',
            deduction: s.payDraft.deduction.trim() || '0',
            notes: s.payDraft.notes.trim(),
          });
          patch({
            payRows: ref.current.payRows.map((r) => (r.employeeId === row.employeeId ? row : r)),
            modal: null,
          });
          // Totals are a sum of the rows, so reload rather than recompute them
          // here — two places deriving the same figure is how they disagree.
          void reloadPayroll();
          flash('Adjustment saved');
        } catch (err) {
          patch({ payFormError: describe(err, 'Could not save that adjustment.') });
        }
      },

      markPayrollPaid: async (employeeId: string) => {
        const s = ref.current;
        try {
          const row = await employeesApi.markPayrollPaid(employeeId, s.payMonth);
          patch({ payRows: ref.current.payRows.map((r) => (r.employeeId === employeeId ? row : r)) });
          void reloadPayroll();
          flash(`${row.name} marked paid`);
        } catch (err) {
          flash(describe(err, 'Could not mark that as paid.'));
        }
      },

      unmarkPayrollPaid: async (employeeId: string) => {
        const s = ref.current;
        try {
          const row = await employeesApi.unmarkPayrollPaid(employeeId, s.payMonth);
          patch({ payRows: ref.current.payRows.map((r) => (r.employeeId === employeeId ? row : r)) });
          void reloadPayroll();
          flash(`${row.name} reopened — the figures track attendance again`);
        } catch (err) {
          flash(describe(err, 'Could not reopen that month.'));
        }
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
              pnl: await reportsApi.getPnl({ from, to: toLocalDay(end) }),
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

        // After the validation guards, which return before any request.
        patch({ expSaving: true });
        try {
          await reportsApi.createExpense({
            date,
            category: cat,
            description: desc.trim(),
            amount: amt.trim(),
          });
          patch({ expSaving: false, modal: null, expDraft: { date, cat, desc: '', amt: '' } });
          flash('Expense logged');
          // Refetch rather than appending: the list is sorted and paginated
          // server-side, and the P&L behind it has changed too.
          void actions.loadReport();
        } catch (err) {
          patch({ expSaving: false, expError: describe(err, 'Could not save that expense.') });
        }
      },

      deleteExpense: async (id: string) => {
        patch({ expSaving: true });
        try {
          await reportsApi.deleteExpense(id);
          patch({ expSaving: false });
          flash('Expense removed');
          void actions.loadReport();
        } catch (err) {
          patch({ expSaving: false });
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
