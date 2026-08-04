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
import {
  CAT_SEED,
  CUSTOMERS,
  EXPENSES,
  KDS_COLS,
  NAV,
  initialMenuItems,
  initialTables,
  initialTickets,
} from './data/seed';
import type {
  CartLine,
  Category,
  Customer,
  Expense,
  ExpenseCategory,
  MenuItem,
  ScreenId,
  Table,
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

export const CONFIG = {
  restaurantName: 'Verdant Café',
  terminalLabel: 'Terminal 1 · Front counter',
  orderNumber: 20,
  pinLength: 4,
  showTaxRow: true,
  requireCustomerName: true,
  showDemoHint: true,
};

export type Modal =
  | { kind: 'cat'; mode: 'add' | 'edit'; target: string | null }
  | { kind: 'item'; mode: 'add' | 'edit'; target: string | null }
  | { kind: 'del'; delKind: 'cat' | 'item'; target: string }
  | { kind: 'cust'; mode: 'add' | 'edit'; target: string | null }
  | { kind: 'exp' };

export interface ItemDraft {
  name: string;
  price: string;
  cat: string;
  desc: string;
  img: string;
  available: boolean;
  color: string;
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
  customer: string;
  cart: CartLine[];
  discountMode: 'flat' | 'pct';
  discountValue: string;
  sendOpen: boolean;
  orderTable: string | null;

  items: MenuItem[];
  cats: Category[];
  selCat: string;
  itemQuery: string;
  hoverCat: string;
  modal: Modal | null;
  draft: ItemDraft;

  tables: Table[];
  zone: string;
  selTable: string | null;
  panel: TablePanel;
  splitCount: number;
  splitMap: Record<number, number>;
  evenSplit: boolean;

  tickets: Ticket[];
  kdsType: string;
  kdsFocus: string | null;

  customers: Customer[];
  custQuery: string;
  selCust: string | null;
  openOrder: number | null;
  custDraft: CustomerDraft;
  custError: string;

  repTab: 'daily' | 'monthly' | 'expenses' | 'pnl';
  repDate: string;
  repMonth: string;
  expenses: Expense[];
  expDesc: boolean;
  expDraft: ExpenseDraft;
  expError: string;
}

const createInitialState = (): State => {
  const now = Date.now();
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

    cat: 'Show All',
    query: '',
    customer: '',
    cart: [
      { id: 'p2', qty: 2, note: '', noteOpen: false },
      { id: 'p10', qty: 1, note: 'extra raita', noteOpen: false },
      { id: 'p6', qty: 1, note: '', noteOpen: false },
    ],
    discountMode: 'flat',
    discountValue: '0',
    sendOpen: false,
    orderTable: null,

    items: initialMenuItems(),
    cats: CAT_SEED.slice(),
    selCat: 'Beverages',
    itemQuery: '',
    hoverCat: '',
    modal: null,
    draft: { name: '', price: '', cat: '', desc: '', img: '', available: true, color: '#00754A' },

    tables: initialTables(now),
    zone: 'All',
    selTable: null,
    panel: 'summary',
    splitCount: 2,
    splitMap: {},
    evenSplit: false,

    tickets: initialTickets(now),
    kdsType: 'All',
    kdsFocus: null,

    customers: CUSTOMERS.slice(),
    custQuery: '',
    selCust: 'c1',
    openOrder: null,
    custDraft: { name: '', phone: '', email: '', notes: '' },
    custError: '',

    repTab: 'daily',
    repDate: '2026-08-02',
    repMonth: '2026-07',
    expenses: EXPENSES.slice(),
    expDesc: true,
    expDraft: { date: '2026-08-02', cat: 'Ingredients', desc: '', amt: '' },
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

    return {
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

      openCatModal: (cat: Category | null) =>
        patch({
          modal: { kind: 'cat', mode: cat ? 'edit' : 'add', target: cat ? cat.name : null },
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
            available: item ? item.available : true,
            color: '#00754A',
          },
        }),

      openDeleteModal: (delKind: 'cat' | 'item', target: string) =>
        patch({ modal: { kind: 'del', delKind, target } }),

      closeModal: () => patch({ modal: null }),

      saveCat: () => {
        const s = ref.current;
        if (s.modal?.kind !== 'cat') return;
        const name = s.draft.name.trim();
        if (!name) return;
        if (s.modal.mode === 'add') {
          if (s.cats.some((c) => c.name === name)) return patch({ modal: null });
          patch({
            cats: [...s.cats, { name, color: s.draft.color }],
            selCat: name,
            modal: null,
          });
          return flash(`Category "${name}" added`);
        }
        const old = s.modal.target;
        patch({
          cats: s.cats.map((c) => (c.name === old ? { name, color: s.draft.color } : c)),
          items: s.items.map((i) => (i.cat === old ? { ...i, cat: name } : i)),
          selCat: s.selCat === old ? name : s.selCat,
          modal: null,
        });
        flash('Category updated');
      },

      saveItem: () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'item') return;
        const name = s.draft.name.trim();
        if (!name) return;
        const price = parseFloat(s.draft.price) || 0;
        if (modal.mode === 'add') {
          const item: MenuItem = {
            id: `i${Date.now()}`,
            name,
            price,
            cat: s.draft.cat || s.selCat,
            img: s.draft.img,
            desc: s.draft.desc,
            available: s.draft.available,
          };
          patch({ items: [...s.items, item], selCat: item.cat, modal: null });
          return flash(`"${name}" added to the menu`);
        }
        patch({
          items: s.items.map((i) =>
            i.id === modal.target
              ? {
                  ...i,
                  name,
                  price,
                  cat: s.draft.cat,
                  desc: s.draft.desc,
                  img: s.draft.img,
                  available: s.draft.available,
                }
              : i,
          ),
          modal: null,
        });
        flash(`"${name}" updated`);
      },

      confirmDelete: () => {
        const s = ref.current;
        if (s.modal?.kind !== 'del') return;
        const { delKind, target } = s.modal;
        if (delKind === 'cat') {
          const rest = s.cats.filter((c) => c.name !== target);
          const doomed = s.items.filter((i) => i.cat === target).map((i) => i.id);
          patch({
            cats: rest,
            items: s.items.filter((i) => i.cat !== target),
            cart: s.cart.filter((l) => !doomed.includes(l.id)),
            selCat: rest.length ? rest[0].name : '',
            modal: null,
          });
          return flash('Category removed');
        }
        patch({
          items: s.items.filter((i) => i.id !== target),
          cart: s.cart.filter((l) => l.id !== target),
          modal: null,
        });
        flash('Item removed from the menu');
      },

      toggleAvailable: (id: string) =>
        patch({
          items: ref.current.items.map((i) =>
            i.id === id ? { ...i, available: !i.available } : i,
          ),
        }),

      pickImage: (file: File) => {
        const reader = new FileReader();
        reader.onload = () => setDraft({ img: String(reader.result) });
        reader.readAsDataURL(file);
      },

      startOrderAt: (table: Table) => {
        shell({ active: 'billing' });
        patch({ orderTable: table.name, selTable: null });
        flash(`New order started on ${table.name}`);
      },

      openTable: (table: Table) => {
        if (table.status === 'occupied') {
          return patch({
            selTable: table.id,
            panel: 'summary',
            splitMap: {},
            evenSplit: false,
            splitCount: 2,
          });
        }
        if (table.status === 'available') {
          shell({ active: 'billing' });
          patch({ orderTable: table.name, selTable: null });
          return flash(`New order started on ${table.name}`);
        }
        patch({ selTable: table.id, panel: 'summary' });
      },

      closePanel: () => patch({ selTable: null, panel: 'summary' }),

      transferTable: (destId: string) => {
        const s = ref.current;
        const src = s.tables.find((t) => t.id === s.selTable);
        if (!src) return;
        patch({
          tables: s.tables.map((t) => {
            if (t.id === destId) {
              return {
                ...t,
                status: 'occupied' as const,
                order: src.order,
                startedAt: src.startedAt,
                merge: src.merge,
              };
            }
            if (t.id === src.id) {
              return {
                ...t,
                status: 'available' as const,
                order: [],
                startedAt: null,
                merge: null,
              };
            }
            return t;
          }),
          selTable: destId,
          panel: 'summary',
        });
        flash(`${src.name} transferred to ${destId}`);
      },

      mergeTable: (otherId: string) => {
        const s = ref.current;
        const src = s.tables.find((t) => t.id === s.selTable);
        if (!src) return;
        const tag = src.merge ?? `M${Date.now().toString().slice(-4)}`;
        patch({
          tables: s.tables.map((t) =>
            t.id === src.id || t.id === otherId ? { ...t, merge: tag } : t,
          ),
          panel: 'summary',
        });
        flash(`${src.name} and ${otherId} now share one bill`);
      },

      assignSplit: (row: number, bill: number) =>
        patch({ splitMap: { ...ref.current.splitMap, [row]: bill } }),

      advanceTicket: (id: string) => {
        const s = ref.current;
        const ticket = s.tickets.find((t) => t.id === id);
        const col = KDS_COLS.find((c) => c.id === ticket?.status);
        if (!ticket || !col?.next) return;
        const next = col.next;
        patch({ tickets: s.tickets.map((t) => (t.id === id ? { ...t, status: next } : t)) });
        flash(`Order #${ticket.no} → ${KDS_COLS.find((c) => c.id === next)!.label}`);
      },

      goPending: () => {
        shell({ active: 'kitchen' });
        patch({ kdsType: 'All', kdsFocus: 'pending' });
      },

      openCustModal: (customer: Customer | null) =>
        patch({
          modal: {
            kind: 'cust',
            mode: customer ? 'edit' : 'add',
            target: customer ? customer.id : null,
          },
          custError: '',
          custDraft: customer
            ? {
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                notes: customer.notes,
              }
            : { name: '', phone: '', email: '', notes: '' },
        }),

      saveCustomer: () => {
        const s = ref.current;
        const modal = s.modal;
        if (modal?.kind !== 'cust') return;
        const name = s.custDraft.name.trim();
        const phone = s.custDraft.phone.trim();
        if (!name) return patch({ custError: 'Enter the customer’s name' });
        if (!phone)
          return patch({ custError: 'Phone number is required — invoices are sent to it' });
        if (modal.mode === 'add') {
          const customer: Customer = {
            id: `c${Date.now()}`,
            name,
            phone,
            email: s.custDraft.email,
            notes: s.custDraft.notes,
            last: '—',
            history: [],
          };
          patch({ customers: [...s.customers, customer], selCust: customer.id, modal: null });
          return flash(`${name} added to customers`);
        }
        patch({
          customers: s.customers.map((c) =>
            c.id === modal.target
              ? { ...c, name, phone, email: s.custDraft.email, notes: s.custDraft.notes }
              : c,
          ),
          modal: null,
        });
        flash('Customer updated');
      },

      orderForCustomer: (customer: Customer) => {
        shell({ active: 'billing' });
        patch({ customer: customer.name, orderTable: null });
        flash(`New order started for ${customer.name}`);
      },

      saveExpense: () => {
        const s = ref.current;
        const { date, cat, desc, amt } = s.expDraft;
        const value = parseFloat(amt);
        if (!desc.trim()) return patch({ expError: 'Add a short description' });
        if (!value || value <= 0) return patch({ expError: 'Enter an amount greater than zero' });
        patch({
          expenses: [
            ...s.expenses,
            { id: `e${Date.now()}`, date, cat, desc: desc.trim(), amt: value },
          ],
          modal: null,
          expDraft: { date, cat, desc: '', amt: '' },
        });
        flash('Expense logged');
      },
    };
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
