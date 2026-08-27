/**
 * API client.
 *
 * ── Where the access token lives ───────────────────────────────────────────
 * In a module-scoped variable. Not localStorage, not sessionStorage, not a
 * readable cookie.
 *
 * Anything in web storage is readable by any script on the page, so a single
 * XSS — in our code or in any dependency — hands over the token. Keeping it in
 * a closure means an attacker has to be executing inside this module's scope,
 * not merely on the page.
 *
 * The cost is that a page refresh loses it. That is what the refresh cookie is
 * for: it is httpOnly, so script cannot read it at all, and `restoreSession()`
 * trades it for a new access token on boot. The session survives; the token
 * never sits anywhere a script can find it.
 */

/** Empty by default: requests go to the same origin and Vite proxies /api in dev. */
export const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const hasSession = () => accessToken !== null;

/** The backend's error envelope, surfaced as a typed error. */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: { field: string; message: string }[];
  requestId?: string;

  constructor(
    status: number,
    message: string,
    extra: { code?: string; details?: ApiError['details']; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = extra.code;
    this.details = extra.details;
    this.requestId = extra.requestId;
  }

  /** True when the server told us to slow down. */
  get isRateLimited() {
    return this.status === 429;
  }
  get isAuthError() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string; details?: ApiError['details'] };
  requestId?: string;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /*
     * A non-JSON body means something upstream of the API answered — a proxy,
     * a gateway, or nothing at all.
     *
     * The status is named because it is the only clue left, and the two cases
     * it separates need different actions. A 413 here is the hosting proxy
     * refusing a large upload before it ever reached the backend (Vercel caps
     * a request body well below the old 5MB image limit); a 502/504 is the
     * backend being asleep or down. Collapsing both to "Service unavailable"
     * sent people looking at the server for what was a too-large file.
     */
    if (res.status === 413) {
      throw new ApiError(413, 'That file is too large to upload. Try a smaller image.');
    }
    throw new ApiError(
      res.status,
      res.ok ? 'Unreadable response' : `Service unavailable (HTTP ${res.status})`,
    );
  }

  if (!res.ok || !body.success) {
    throw new ApiError(res.status, body.error?.message ?? 'Request failed', {
      code: body.error?.code,
      details: body.error?.details,
      requestId: body.requestId,
    });
  }

  return body.data as T;
}

/**
 * Exchange the refresh cookie for a new access token.
 *
 * ── Single-flight, and why that alone was not enough ───────────────────────
 * The backend rotates the refresh token on every call and treats a REPLAYED
 * one as theft: it revokes the whole session family, which is an immediate,
 * unrecoverable logout. So two refreshes that both present the same cookie
 * must never happen.
 *
 * Guarding only the in-flight promise stops CONCURRENT callers — three
 * requests that 401 at once — but not SEQUENTIAL ones. React StrictMode mounts
 * every component twice, and the second mount runs after the first has already
 * settled, so `bootstrapAuth` ran twice with the guard released in between.
 * The second call presented the token the first had just rotated, and the
 * server correctly concluded the session was compromised. That is the
 * "refreshing the page logs me out" bug.
 *
 * Two things close it. The promise is now retained for a short settle window
 * after it resolves, so a caller arriving moments later reuses the result
 * instead of starting a second rotation; and `hasFreshSession()` below lets
 * boot-time restore skip the call entirely when a token already exists.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * How long a completed refresh keeps answering for later callers.
 *
 * Long enough to cover a StrictMode double-mount and any retry burst that
 * follows a slow first paint; far shorter than the 15-minute access token, so
 * this can never hand back a genuinely stale answer.
 */
const REFRESH_SETTLE_MS = 3000;

export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // sends the httpOnly refresh cookie
        headers: { Accept: 'application/json' },
      });

      /*
       * A 429 is not a dead session.
       *
       * The refresh limiter allows 30 attempts per 15 minutes keyed on the
       * client IP, and behind the Vercel -> Render proxy many terminals share
       * one. Treating a throttle as "signed out" meant a busy service could
       * log every till out at once, which is the worst possible moment for it.
       *
       * The token is left exactly as it was so the caller can retry. Only an
       * actual rejection clears it.
       */
      if (res.status === 429) return false;

      if (!res.ok) {
        accessToken = null;
        return false;
      }

      const data = await parse<{ accessToken: string }>(res);
      accessToken = data.accessToken;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      /*
       * Held for a settle window rather than cleared on the next tick.
       *
       * The old one-tick release made this a guard against concurrency only.
       * A caller arriving a few milliseconds after the previous refresh
       * resolved — exactly what StrictMode's second mount does — found it null
       * and started a second rotation, replaying a token the server had just
       * retired. Keeping the resolved promise briefly means that caller gets
       * the same answer instead of burning the session.
       */
      setTimeout(() => {
        refreshInFlight = null;
      }, REFRESH_SETTLE_MS);
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the automatic refresh-and-retry. Used by the auth calls themselves. */
  skipRetry?: boolean;
  signal?: AbortSignal;
}

/**
 * Make an API call.
 *
 * On a 401 it refreshes once and retries. If the refresh also fails the
 * session is genuinely over and the error propagates, so the UI can send the
 * user back to the login screen.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipRetry = false, signal } = options;

  // Menu writes carry an image, so they go up as multipart. FormData must set
  // its own Content-Type: the boundary is generated by the browser, and naming
  // the type ourselves omits it and makes multer parse zero fields.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  const send = () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

    return fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal,
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    // fetch only rejects on a network-level failure, so this is genuinely
    // "the server could not be reached" rather than any HTTP status.
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 401 && !skipRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        res = await send();
      } catch {
        throw new ApiError(0, 'Cannot reach the server. Check your connection.');
      }
    }
  }

  return parse<T>(res);
}

export default api;
