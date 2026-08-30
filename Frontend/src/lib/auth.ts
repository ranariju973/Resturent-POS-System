/**
 * Auth service — the boundary between backend shapes and the app's own types.
 *
 * The backend speaks snake_case roles (`kitchen_staff`) and minimal user
 * objects; the UI has always spoken `Staff` with display labels. Translating
 * in one place means the screens never learn the wire format, and swapping the
 * backend later touches only this file.
 */
import { api, setAccessToken, refreshSession, ApiError } from './api';
import type { Role, Staff } from '../data/types';

/** Exactly what the backend's `publicUser()` returns. */
export interface ApiUser {
  id: string;
  name: string;
  role: 'admin' | 'cashier' | 'kitchen_staff';
  roleLabel: string;
  email: string | null;
  avatarUrl: string;
  lastLoginAt: string | null;
  /**
   * Derived server-side from the role. Used only to decide what the UI offers
   * — every request is still authorised on the server, which never reads this
   * list back from the client. See src/lib/permissions.ts.
   */
  permissions: string[];
  dashboardScope: 'full' | 'limited' | null;
}

/** The restaurant a session belongs to. Null before onboarding names one. */
export interface Restaurant {
  id: string;
  name: string;
  slug: string;
}

/** The terminal this browser is linked to, when it is. */
export interface Terminal {
  name: string;
}

/** A terminal as the management list reports it. */
export interface TerminalRow {
  id: string;
  name: string;
  /** Last staff PIN sign-in on it. Null for one never used, or just re-linked. */
  lastSeenAt: string | null;
  createdAt: string;
}

/**
 * Returned when a Google account has signed in but belongs to no restaurant.
 *
 * Not an error: the session is real, it simply cannot reach anything until a
 * restaurant exists. The server enforces that — such a token can only reach
 * GET /auth/me and POST /tenants — so this flag decides which SCREEN to
 * render, never whether the app is allowed to.
 */
export interface Onboarding {
  required: boolean;
  suggestedName?: string;
}

/** The app's Staff shape, plus the id, role and permissions the API needs. */
export interface SessionUser extends Staff {
  id: string;
  /** Wire form — what the permission map is keyed on. */
  apiRole: ApiUser['role'];
  permissions: string[];
  dashboardScope: 'full' | 'limited' | null;
}

const ROLE_LABEL: Record<ApiUser['role'], Role> = {
  admin: 'Admin',
  cashier: 'Cashier',
  kitchen_staff: 'Kitchen Staff',
};

/**
 * Deterministic fallback avatar, so a staff member with no uploaded image
 * still gets a stable face rather than a different one on every render.
 */
function fallbackAvatar(user: ApiUser): string {
  let hash = 0;
  for (let i = 0; i < user.id.length; i += 1) hash = (hash * 31 + user.id.charCodeAt(i)) | 0;
  return `https://i.pravatar.cc/96?img=${(Math.abs(hash) % 70) + 1}`;
}

export function toSessionUser(user: ApiUser): SessionUser {
  return {
    id: user.id,
    name: user.name,
    role: ROLE_LABEL[user.role] ?? 'Cashier',
    apiRole: user.role,
    avatar: user.avatarUrl || fallbackAvatar(user),
    // Default to an empty list rather than a permissive one: a malformed
    // response should hide everything, not reveal everything.
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    dashboardScope: user.dashboardScope ?? null,
  };
}

interface LoginResponse {
  accessToken: string;
  user: ApiUser;
  restaurant?: Restaurant | null;
  terminal?: Terminal | null;
  onboarding?: { required: boolean; suggestedName?: string } | null;
  /**
   * Something that happened TO the account during this sign-in, in words the
   * person can act on. Not an error — the sign-in succeeded.
   *
   * The one case today: a Google identity claimed an account that had an
   * unverified password, and that password was discarded. Silence there would
   * mean an owner discovering it at the next sign-in, with no reset flow and
   * no way to work out why.
   */
  notice?: string | null;
}

/** What a completed sign-in gives the app. */
export interface Session {
  user: SessionUser;
  restaurant: Restaurant | null;
  terminal: Terminal | null;
  /** Non-null only when the account has no restaurant yet. */
  onboarding: Onboarding | null;
  /** Something the server needs to tell the person about their account. */
  notice: string | null;
}

const toSession = (data: LoginResponse): Session => ({
  user: toSessionUser(data.user),
  restaurant: data.restaurant ?? null,
  terminal: data.terminal ?? null,
  onboarding: data.onboarding?.required
    ? { required: true, suggestedName: data.onboarding.suggestedName }
    : null,
  notice: data.notice ?? null,
});

/**
 * Owners and administrators — a Google ID token.
 *
 * May return a session with `onboarding` set and no restaurant. That is a
 * successful sign-in, not a failure: the account exists and is authenticated,
 * it just has not named a restaurant yet.
 */
export async function loginGoogle(credential: string): Promise<Session> {
  const data = await api<LoginResponse>('/api/auth/google', {
    method: 'POST',
    body: { credential },
    // A 401 here means the token was rejected, not that ours expired —
    // retrying through a refresh would be meaningless.
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSession(data);
}

/** What the signup form collects. */
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

/**
 * Create an owner account with an email and a password.
 *
 * Always returns a session with `onboarding` set — a brand-new account has no
 * restaurant by definition, so the naming step comes next. That makes the
 * response shape identical to a first-time Google sign-in, which is why the
 * store can hand both to the same handler.
 */
export async function registerWithPassword(input: RegisterInput): Promise<Session> {
  const data = await api<LoginResponse>('/api/auth/register', {
    method: 'POST',
    body: input,
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSession(data);
}

/**
 * Owners and administrators — email + password.
 *
 * May also return a session with `onboarding` set: an owner can abandon the
 * naming step and sign back in days later.
 */
export async function loginWithPassword(email: string, password: string): Promise<Session> {
  const data = await api<LoginResponse>('/api/auth/login/password', {
    method: 'POST',
    body: { email, password },
    // A 401 here means the credentials were refused, not that our token
    // expired — retrying through a refresh would be meaningless.
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSession(data);
}

/**
 * Cashier / kitchen staff — PIN.
 *
 * The restaurant is not sent: it comes from the terminal's device cookie,
 * which rides along automatically. A PIN alone would be ambiguous, since two
 * restaurants can both issue 1234.
 */
export async function loginStaff(pin: string): Promise<Session> {
  const data = await api<LoginResponse>('/api/auth/login/staff', {
    method: 'POST',
    body: { pin },
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSession(data);
}

/**
 * Name a restaurant and become its administrator.
 *
 * The server revokes the pre-onboarding token and issues a fresh one, so the
 * new access token must replace the old — the previous one stops working the
 * moment this returns.
 */
export async function createRestaurant(name: string): Promise<Session> {
  const data = await api<LoginResponse>('/api/tenants', {
    method: 'POST',
    body: { name },
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSession(data);
}

/** What restaurant this browser's terminal belongs to. Read before any sign-in. */
export interface TerminalInfo {
  linked: boolean;
  restaurant: { name: string; slug: string } | null;
  terminal: Terminal | null;
}

/**
 * Ask, before anyone signs in, which restaurant this terminal is linked to.
 *
 * Unauthenticated by design — the login screen has no session yet, and a
 * keypad that cannot name its restaurant gives a cashier no way to notice they
 * are standing at the wrong one. Never throws: an unreachable server is
 * reported as "not linked", which is the state whose screen tells someone what
 * to do about it.
 */
export async function fetchTerminalInfo(): Promise<TerminalInfo> {
  try {
    return await api<TerminalInfo>('/api/auth/terminal', { skipRetry: true });
  } catch {
    return { linked: false, restaurant: null, terminal: null };
  }
}

/*
 * Terminal management.
 *
 * Under /api/auth rather than /api/devices because the device cookie is scoped
 * to that path — see the header of Backend/src/routes/devices.js.
 */
const TERMINALS = '/api/auth/devices';

/** Every terminal in the signed-in administrator's restaurant. */
export async function listTerminals(): Promise<TerminalRow[]> {
  const data = await api<{ terminals: TerminalRow[] }>(TERMINALS, { skipRetry: true });
  return data.terminals;
}

/** Link THIS browser to the restaurant as a NEW terminal. */
export async function linkTerminal(name: string): Promise<Terminal> {
  const data = await api<{ terminal: Terminal }>(TERMINALS, {
    method: 'POST',
    body: { name },
    skipRetry: true,
  });
  return data.terminal;
}

/**
 * Point an EXISTING terminal at this browser.
 *
 * The verb that makes a shared machine recoverable. The device cookie belongs
 * to the browser and survives logout, so on a machine two owners have both
 * used, the second one's cookie is what the first one's session finds — and
 * without this, the only way back was to invent a name the machine's own old
 * row had already taken.
 *
 * Rotates the terminal's token, so whichever browser held it before stops
 * resolving it. The UI says so before the owner commits.
 */
export async function relinkTerminal(id: string): Promise<Terminal> {
  const data = await api<{ terminal: Terminal }>(`${TERMINALS}/${id}/relink`, {
    method: 'POST',
    body: {},
    skipRetry: true,
  });
  return data.terminal;
}

/** Rename a terminal. Touches the label only, never which machine answers to it. */
export async function renameTerminal(id: string, name: string): Promise<TerminalRow> {
  const data = await api<{ terminal: TerminalRow }>(`${TERMINALS}/${id}`, {
    method: 'PATCH',
    body: { name },
    skipRetry: true,
  });
  return data.terminal;
}

/** Retire a terminal — a machine lost, sold or replaced. */
export async function unlinkTerminal(id: string): Promise<void> {
  await api<{ unlinked: boolean }>(`${TERMINALS}/${id}`, {
    method: 'DELETE',
    skipRetry: true,
  });
}

/**
 * Restore a session on page load, using the httpOnly refresh cookie.
 * Returns null when there is no valid session — the normal case for a first
 * visit, so it must not surface as an error.
 */
let restoreInFlight: Promise<Session | null> | null = null;

export function restoreSession(): Promise<Session | null> {
  /*
   * Deduplicated for the lifetime of the page, not just while in flight.
   *
   * Restoring a session is a once-per-load act, and doing it twice is not
   * merely wasteful: each attempt rotates the refresh token, and presenting a
   * rotated one is what the server treats as theft — it revokes the session
   * family and the user is thrown out. React StrictMode calls the boot effect
   * twice by design, so "once per load" has to be enforced here rather than
   * assumed.
   *
   * The promise is retained deliberately. A second caller receives the first
   * call's Session — which is the correct answer to "what is this session?" —
   * instead of starting a rotation that would invalidate it.
   */
  if (restoreInFlight) return restoreInFlight;

  restoreInFlight = (async () => {
    const ok = await refreshSession();
    if (!ok) return null;

    try {
      const data = await api<LoginResponse>('/api/auth/me', { skipRetry: true });
      return toSession(data);
    } catch {
      return null;
    }
  })();

  return restoreInFlight;
}

/**
 * Forget the memoised restore, so the next call really talks to the server.
 *
 * Signing out ends the session that `restoreSession` cached; without this, a
 * sign-out followed by a sign-in on the same page would replay the previous
 * user's result.
 */
export function resetRestoredSession(): void {
  restoreInFlight = null;
}

/**
 * End the session. Always clears locally, even if the server call fails —
 * a user pressing "log out" on a flaky connection must not stay logged in
 * on screen.
 */
export async function logout(allDevices = false): Promise<void> {
  try {
    await api<void>('/api/auth/logout', {
      method: 'POST',
      body: { allDevices },
      skipRetry: true,
    });
  } catch {
    // Intentionally ignored — see above.
  } finally {
    setAccessToken(null);
    // The memoised restore describes the session that just ended.
    resetRestoredSession();
  }
}

/**
 * Turn an error into something worth showing on the login screen.
 *
 * The backend deliberately returns one generic message for every failed login
 * so the form cannot be used to discover which accounts exist. That message is
 * passed through unchanged; only rate-limiting and connection failures get
 * clearer wording, since those are actionable by the person at the terminal.
 */
export function loginErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;

  if (err.status === 0) return 'Cannot reach the server. Check your connection.';
  if (err.isRateLimited) return 'Too many attempts. Wait a few minutes and try again.';
  if (isTerminalNotLinked(err)) return 'This terminal is not set up yet.';
  if (err.status === 400 && err.details?.length) return err.details[0].message;
  if (err.isAuthError) return fallback;

  return err.message || fallback;
}

/**
 * Is this the "terminal was never linked" answer?
 *
 * The server deliberately makes this one distinguishable from every other
 * login failure, because it is not a credential failure: it says only that
 * THIS browser holds no device cookie, which the browser already knows. The
 * client needs to tell them apart to show the setup screen rather than a red
 * "wrong PIN" under the keypad.
 */
export function isTerminalNotLinked(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'TERMINAL_NOT_LINKED';
}

/**
 * Is this "a terminal already has that name"?
 *
 * Distinguishable on purpose. It is the one refusal the setup screen can act
 * on by itself: the colliding row is almost always this very machine's, so the
 * client selects it in the picker and offers to re-link rather than asking for
 * a name nobody has used yet.
 */
export function isTerminalNameTaken(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'TERMINAL_NAME_TAKEN';
}

export { ApiError };
