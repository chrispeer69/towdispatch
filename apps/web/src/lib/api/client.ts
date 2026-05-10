/**
 * Server-side fetch wrappers.
 *
 * Two functions, picked by where you're calling from:
 *
 *   apiServer    — read-only context safe. Reads the access cookie, attaches
 *                  it as Bearer auth, and returns the response or throws an
 *                  ApiError. NEVER writes cookies. On a 401 the caller decides
 *                  what to do (server components: redirect to /login).
 *
 *   apiServerBff — for use INSIDE Next.js Route Handlers (`/api/*`). Layers a
 *                  refresh-on-401 retry on top of apiServer: if the API answers
 *                  401, swap in the refresh token, call /auth/refresh,
 *                  rotate the cookies, and retry once. Cookie writes are only
 *                  allowed in route handlers / server actions, so this MUST
 *                  NOT be invoked from a server-component render path.
 *
 * Why the split: Next.js 15 forbids cookies().set() during a server-component
 * render. Calling apiServerBff from a layout/page would crash. Splitting the
 * surface makes the two contexts impossible to confuse.
 */
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  readAccessToken,
  readRefreshToken,
  setSessionCookies,
} from '../auth/cookies';

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

const apiBase = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:3001';

interface RequestOpts<TBody> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: TBody;
  /** Set false to skip the auth header. Default: true. */
  authenticated?: boolean;
  /** Forwarded to fetch's `cache` option. Default: 'no-store'. */
  cache?: RequestCache;
}

/**
 * Read-only API call. Safe in any server context (layouts, pages, route
 * handlers). On non-2xx, throws ApiError — server components catch a 401 and
 * decide whether to redirect.
 */
export async function apiServer<TResponse, TBody = unknown>(
  path: string,
  opts: RequestOpts<TBody> = {},
): Promise<TResponse> {
  const authenticated = opts.authenticated ?? true;
  const accessToken = authenticated ? await readAccessToken() : null;
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`;

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: buildHeaders(accessToken, opts.body !== undefined),
    cache: opts.cache ?? 'no-store',
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  return parseResponse<TResponse>(res);
}

/**
 * BFF-only API call. Identical to apiServer except that, on 401, it tries the
 * refresh-token rotation and retries once. ONLY safe in Next.js Route
 * Handlers — calling this from a server component will crash with
 * "Cookies can only be modified in a Server Action or Route Handler".
 */
export async function apiServerBff<TResponse, TBody = unknown>(
  path: string,
  opts: RequestOpts<TBody> = {},
): Promise<TResponse> {
  const authenticated = opts.authenticated ?? true;
  let accessToken = authenticated ? await readAccessToken() : null;
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
  return parseResponse<TResponse>(res);
}

function buildHeaders(accessToken: string | null, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
      errors?: unknown;
    } | null;
    const code = body?.code ?? 'request_failed';
    const message = body?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, code, message, body?.errors);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/**
 * Trade the refresh-cookie for a new token pair and rotate cookies. Returns
 * the new access token on success, null on failure. ONLY safe in route
 * handlers — writes cookies via setSessionCookies.
 */
export async function tryRefresh(): Promise<{ accessToken: string } | null> {
  const refreshToken = await readRefreshToken();
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
  let accessToken = await readAccessToken();
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
