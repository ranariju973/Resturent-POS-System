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
}

/** What a completed sign-in gives the app. */
export interface Session {
  user: SessionUser;
  restaurant: Restaurant | null;
  terminal: Terminal | null;
  /** Non-null only when the account has no restaurant yet. */
  onboarding: Onboarding | null;
}

const toSession = (data: LoginResponse): Session => ({
  user: toSessionUser(data.user),
  restaurant: data.restaurant ?? null,
  terminal: data.terminal ?? null,
  onboarding: data.onboarding?.required
    ? { required: true, suggestedName: data.onboarding.suggestedName }
    : null,
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

/** Link THIS browser to the signed-in administrator's restaurant. */
export async function linkTerminal(name: string): Promise<Terminal> {
  const data = await api<{ terminal: Terminal }>('/api/devices', {
    method: 'POST',
    body: { name },
    skipRetry: true,
  });
  return data.terminal;
}

/**
 * Restore a session on page load, using the httpOnly refresh cookie.
 * Returns null when there is no valid session — the normal case for a first
 * visit, so it must not surface as an error.
 */
export async function restoreSession(): Promise<Session | null> {
  const ok = await refreshSession();
  if (!ok) return null;

  try {
    const data = await api<LoginResponse>('/api/auth/me', { skipRetry: true });
    return toSession(data);
  } catch {
    return null;
  }
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

export { ApiError };
