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
}

/** Admin — email + password. */
export async function loginAdmin(email: string, password: string): Promise<SessionUser> {
  const data = await api<LoginResponse>('/api/auth/login/admin', {
    method: 'POST',
    body: { email, password },
    // A 401 here means "wrong credentials", not "expired token" — retrying
    // through a refresh would be meaningless.
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSessionUser(data.user);
}

/** Cashier / kitchen staff — PIN. */
export async function loginStaff(pin: string): Promise<SessionUser> {
  const data = await api<LoginResponse>('/api/auth/login/staff', {
    method: 'POST',
    body: { pin },
    skipRetry: true,
  });

  setAccessToken(data.accessToken);
  return toSessionUser(data.user);
}

/**
 * Restore a session on page load, using the httpOnly refresh cookie.
 * Returns null when there is no valid session — the normal case for a first
 * visit, so it must not surface as an error.
 */
export async function restoreSession(): Promise<SessionUser | null> {
  const ok = await refreshSession();
  if (!ok) return null;

  try {
    const data = await api<{ user: ApiUser }>('/api/auth/me', { skipRetry: true });
    return toSessionUser(data.user);
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
  if (err.status === 400 && err.details?.length) return err.details[0].message;
  if (err.isAuthError) return fallback;

  return err.message || fallback;
}

export { ApiError };
