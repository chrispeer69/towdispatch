/**
 * Server-side fetch wrappers.
 *
 * Two access modes — read-only (apiServer*) vs BFF refresh-on-401 (apiServerBff*) —
 * and two error modes — non-throwing safe (default for server-component data
 * loading) vs throwing (legacy / mutation paths that want to fail loud).
 *
 *   apiServerSafe    — read-only context safe. Returns { data, error } so a
 *                      single 401/403 from one endpoint cannot crash the host
 *                      page render. ApiError is still thrown for 5xx, network
 *                      failures, and malformed JSON (genuinely unexpected).
 *
 *   apiServer        — same as apiServerSafe but unwraps and throws on any
 *                      ApiError. Use this in route handlers, server actions,
 *                      and form mutations where any non-2xx should surface
 *                      as an exception. Server components should generally
 *                      prefer apiServerSafe (or tryFetch around a typed
 *                      fetcher).
 *
 *   apiServerBff*    — for use INSIDE Next.js Route Handlers (`/api/*`). Layers
 *                      a refresh-on-401 retry on top: if the API answers 401,
 *                      swap in the refresh token, call /auth/refresh, rotate
 *                      the cookies, and retry once. Cookie writes are only
 *                      allowed in route handlers / server actions, so this
 *                      MUST NOT be invoked from a server-component render path.
 *
 * Why the split: Next.js 15 forbids cookies().set() during a server-component
 * render. Calling apiServerBff* from a layout/page would crash. Splitting the
 * surface makes the two contexts impossible to confuse.
 *
 * Cookie reading: every variant calls `cookies()` from `next/headers` INLINE
 * (not via a helper) before issuing the fetch. PRs #5–#11 chased a production
 * bug where server-side fetches went out with no Authorization header even
 * though /auth/me appeared to work; diagnostic logs proved
 * `hasAuth=false tokenPrefix=none` for fetches reaching the API. The
 * underlying cause was the `cookies()` request-scoped store not being read at
 * the call site in production builds when the read was routed through a
 * separate module's helper. Inlining the read keeps Next.js's dynamic-API
 * tracking attached to the call site, which is what every Next.js 15 server-
 * component example does — and what fixes the bounce.
 */
import { cookies, headers } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE, getSessionToken, setSessionCookies } from '../auth/cookies';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Discriminated result returned by the safe variants. On success, data is
 * populated and error is null; on a 4xx the error is structured and data is
 * null. 5xx / network / parse failures still throw — those are genuine
 * unexpected errors and the (app)/error.tsx boundary catches them.
 */
export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

/**
 * Server-side API base. Prefers the Railway private-networking hostname so
 * the request never leaves the project's VPC.
 *
 * Resolution order:
 *   1. API_INTERNAL_URL    — set on the web service in Railway to the
 *                            project-private hostname, e.g.
 *                            http://backend.railway.internal:8080. http://
 *                            is correct: traffic stays inside the VPC and
 *                            the internal hostname has no TLS cert.
 *   2. API_PUBLIC_URL      — server-only override, kept for completeness.
 *   3. NEXT_PUBLIC_API_URL — last-resort fallback. This var is still the
 *                            value the BROWSER bundles read (Socket.IO
 *                            handshake, etc.) — do NOT unset it. Keep it
 *                            pointed at the public hostname.
 *   4. localhost:3001      — local dev.
 *
 * Only `apiServer*` (server-only) goes through this resolver. Client-side
 * code that needs to reach the API directly (the Socket.IO handshake in
 * /api/socket/token's response payload) reads NEXT_PUBLIC_API_URL on its
 * own and is unaffected.
 */
const apiBase = (): string =>
  process.env.API_INTERNAL_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

interface RequestOpts<TBody> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: TBody;
  /** Set false to skip the auth header. Default: true. */
  authenticated?: boolean;
  /** Forwarded to fetch's `cache` option. Default: 'no-store'. */
  cache?: RequestCache;
  /**
   * Caller-provided access token. When defined (including `null`), it
   * replaces the inline `cookies()` read inside the fetcher. Server
   * components that reach the API through a typed fetcher in
   * `lib/api/*.ts` MUST set this — see BUILD_DECISIONS.md Session 9.7.
   * Next.js 15's dynamic-API request scope does not survive the second
   * module boundary in production builds, so `cookies()` returns an
   * empty store when called from inside the typed fetcher's call site
   * (one hop removed from the page). Reading at the page level and
   * passing the value through restores the link.
   */
  accessToken?: string | null;
}

async function resolveAccessToken(opts: RequestOpts<unknown>): Promise<string | null> {
  if (opts.accessToken !== undefined) return opts.accessToken;
  const cached = await getSessionToken();
  if (cached) return cached;
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const tokenFromHeader =
    cookieHeader
      .split(/;\s*/)
      .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
      ?.slice(ACCESS_COOKIE.length + 1) ?? null;
  if (tokenFromHeader) return tokenFromHeader;
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

async function resolveRefreshToken(): Promise<string | null> {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const tokenFromHeader =
    cookieHeader
      .split(/;\s*/)
      .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))
      ?.slice(REFRESH_COOKIE.length + 1) ?? null;
  if (tokenFromHeader) return tokenFromHeader;
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}

/**
 * Read-only API call, non-throwing variant. Server-component safe.
 *
 * A 4xx response is returned as `{ data: null, error: ApiError }` so the host
 * page can degrade gracefully (sidebar prefetches, missing-scope endpoints,
 * not-yet-connected integrations). 5xx, network errors, and malformed JSON
 * still throw — those are unexpected and should hit the error boundary.
 */
export async function apiServerSafe<TResponse, TBody = unknown>(
  path: string,
  opts: RequestOpts<TBody> = {},
): Promise<ApiResult<TResponse>> {
  const authenticated = opts.authenticated ?? true;
  // Token resolution: caller-provided wins, otherwise read from headers/cookies
  // at this call site. See RequestOpts.accessToken for why callers from typed
  // fetchers in lib/api/*.ts have to override it.
  let accessToken: string | null = null;
  if (authenticated) {
    accessToken = await resolveAccessToken(opts);
  }
  const base = apiBase();
  const url = path.startsWith('http') ? path : `${base}${path}`;

  // [diag-list-empty] Temporary: surface SSR auth state per request so we can
  // see in Railway logs whether the list-page bounce is "no cookie reached
  // SSR" vs "cookie reached SSR but API said 401" vs "200 but empty body".
  // Remove once the list-pages-empty triage closes.
  if (authenticated) {
    // eslint-disable-next-line no-console
    console.log('[diag-list-empty]', { path, hasAuth: Boolean(accessToken) });
  }

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: buildHeaders(accessToken, opts.body !== undefined),
    cache: opts.cache ?? 'no-store',
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    // [diag-list-empty] Temporary: log every non-2xx with the exact request
    // URL, status, and structured error fields so we can distinguish 400
    // (Zod validation) vs 403 (roles guard) vs 404 (wrong API hostname) for
    // the list-pages-empty triage. Reads a clone of the response so
    // parseResponseSafe below can still consume the original body. Does NOT
    // log the access token or the full response body. Remove once the
    // triage closes.
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    try {
      const body = (await res.clone().json()) as { code?: string; message?: string } | null;
      errorCode = body?.code;
      errorMessage = body?.message;
    } catch {
      // body was not JSON — leave errorCode/errorMessage undefined.
    }
    // eslint-disable-next-line no-console
    console.log('[diag-list-empty:resp]', {
      tag: 'diag-list-empty:resp',
      path,
      requestUrl: url,
      status: res.status,
      hasAuth: Boolean(accessToken),
      base,
      errorCode,
      errorMessage,
    });
  }
  return parseResponseSafe<TResponse>(res);
}

/**
 * Read-only API call, throwing variant. Wraps apiServerSafe and unwraps the
 * result, throwing the ApiError on any 4xx. Use this in route handlers,
 * server actions, or any path that explicitly wants to fail loud.
 */
export async function apiServer<TResponse, TBody = unknown>(
  path: string,
  opts: RequestOpts<TBody> = {},
): Promise<TResponse> {
  const result = await apiServerSafe<TResponse, TBody>(path, opts);
  if (result.error) throw result.error;
  return result.data;
}

/**
 * BFF-only API call, non-throwing variant. Same refresh-on-401 retry behavior
 * as apiServerBff. ONLY safe in Next.js Route Handlers.
 */
export async function apiServerBffSafe<TResponse, TBody = unknown>(
  path: string,
  opts: RequestOpts<TBody> = {},
): Promise<ApiResult<TResponse>> {
  const authenticated = opts.authenticated ?? true;
  let accessToken: string | null = null;
  if (authenticated) {
    accessToken = await resolveAccessToken(opts);
  }
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`;

  const buildInit = (token: string | null): RequestInit => {
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: buildHeaders(token, opts.body !== undefined),
      cache: opts.cache ?? 'no-store',
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return init;
  };

  let res = await fetch(url, buildInit(accessToken));
  if (res.status === 401 && authenticated) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      accessToken = refreshed.accessToken;
      res = await fetch(url, buildInit(accessToken));
    }
  }
  return parseResponseSafe<TResponse>(res);
}

/**
 * BFF-only API call, throwing variant. Identical to apiServer except that, on
 * 401, it tries the refresh-token rotation and retries once. ONLY safe in
 * Next.js Route Handlers — calling this from a server component will crash
 * with "Cookies can only be modified in a Server Action or Route Handler".
 */
export async function apiServerBff<TResponse, TBody = unknown>(
  path: string,
  opts: RequestOpts<TBody> = {},
): Promise<TResponse> {
  const result = await apiServerBffSafe<TResponse, TBody>(path, opts);
  if (result.error) throw result.error;
  return result.data;
}

function buildHeaders(accessToken: string | null, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function parseResponseSafe<T>(res: Response): Promise<ApiResult<T>> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
      errors?: unknown;
    } | null;
    const code = body?.code ?? (res.status === 401 ? 'unauthorized' : 'request_failed');
    const message = body?.message ?? `Request failed with status ${res.status}`;
    const error = new ApiError(res.status, code, message, body?.errors);
    // 5xx is "something is broken" — let the error boundary catch it. 4xx is
    // an expected outcome of business state (no scope, not connected, not
    // found) and is returned as data.
    if (res.status >= 500) throw error;
    return { data: null, error };
  }
  if (res.status === 204) return { data: undefined as unknown as T, error: null };
  try {
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    // Malformed JSON on a 2xx — genuinely unexpected, fall through to boundary.
    throw new ApiError(res.status, 'malformed_response', 'Failed to parse response body', err);
  }
}

/**
 * Convert any throwing typed fetcher (the helpers in lib/api/*.ts) into a
 * non-throwing ApiResult. Lets server components use the existing typed
 * surface without inlining try/catch around every call.
 *
 * Example:
 *   const status = await tryFetch(() => fetchAccountingStatus());
 *   if (status.error) return <NotConnected />;
 */
export async function tryFetch<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    if (err instanceof ApiError) {
      // Same 4xx-vs-5xx split as parseResponseSafe — 5xx falls through.
      if (err.status >= 500) throw err;
      return { data: null, error: err };
    }
    throw err;
  }
}

/** True for ApiError 401/403 — the two statuses callers commonly want to swallow. */
export function isAuthError(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/**
 * Trade the refresh-cookie for a new token pair and rotate cookies. Returns
 * the new access token on success, null on failure. ONLY safe in route
 * handlers — writes cookies via setSessionCookies.
 */
export async function tryRefresh(): Promise<{ accessToken: string } | null> {
  const refreshToken = await resolveRefreshToken();
  if (!refreshToken) return null;
  const res = await fetch(`${apiBase()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  await setSessionCookies({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  return { accessToken: data.accessToken };
}

/**
 * BFF call that returns the raw fetch Response — used by routes that stream
 * binary payloads (PDFs, file downloads). Same refresh-on-401 behavior as
 * apiServerBff. Caller is responsible for piping the body through to the
 * NextResponse.
 */
export async function apiServerBffRaw(
  path: string,
  opts: { method?: 'GET' | 'POST' } = {},
): Promise<Response> {
  let accessToken = await resolveAccessToken({});
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`;
  const buildInit = (token: string | null): RequestInit => ({
    method: opts.method ?? 'GET',
    headers: buildHeaders(token, false),
    cache: 'no-store',
  });
  let res = await fetch(url, buildInit(accessToken));
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      accessToken = refreshed.accessToken;
      res = await fetch(url, buildInit(accessToken));
    }
  }
  return res;
}

// Re-export the cookie names so BFF routes can clear them by name in error paths.
export { ACCESS_COOKIE, REFRESH_COOKIE };
