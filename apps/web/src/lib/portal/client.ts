/**
 * Server-side portal API client (Session 32).
 *
 * The customer-facing portal is multi-tenant by Host, but the browser talks
 * to this Next app, and THIS app talks to the API — so the API never sees the
 * customer's Host directly. Every portal call forwards the resolved portal
 * host in the `X-Portal-Host` header; the API resolves the tenant from it.
 *
 * Single stateless token (no refresh rotation) → no BFF retry dance like the
 * staff client. Public calls (resolve/login/signup/…) carry the host only;
 * authenticated calls additionally carry the portal bearer token.
 */
import { headers } from 'next/headers';

const apiBase = (): string =>
  process.env.API_INTERNAL_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type PortalResult<T> = { data: T; error: null } | { data: null; error: PortalApiError };

/**
 * The portal host the browser used. Behind Railway's proxy the real host is
 * in x-forwarded-host; fall back to host. Optionally overridden in dev via
 * PORTAL_DEV_HOST so a developer without a wildcard-DNS setup can exercise the
 * portal locally.
 */
export async function getPortalHost(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-host');
  const host = forwarded ?? h.get('host') ?? '';
  if (
    (!host || host.startsWith('localhost') || host.startsWith('127.')) &&
    process.env.PORTAL_DEV_HOST
  ) {
    return process.env.PORTAL_DEV_HOST;
  }
  return host;
}

interface CallOpts<TBody> {
  method?: 'GET' | 'POST';
  body?: TBody;
  token?: string | null;
  host?: string;
}

/** Throwing variant. */
export async function portalApi<TResponse, TBody = unknown>(
  path: string,
  opts: CallOpts<TBody> = {},
): Promise<TResponse> {
  const result = await portalApiSafe<TResponse, TBody>(path, opts);
  if (result.error) throw result.error;
  return result.data;
}

/** Non-throwing variant — 4xx returned as structured error, 5xx/parse throw. */
export async function portalApiSafe<TResponse, TBody = unknown>(
  path: string,
  opts: CallOpts<TBody> = {},
): Promise<PortalResult<TResponse>> {
  const host = opts.host ?? (await getPortalHost());
  const headersInit: Record<string, string> = {
    Accept: 'application/json',
    'X-Portal-Host': host,
  };
  if (opts.body !== undefined) headersInit['Content-Type'] = 'application/json';
  if (opts.token) headersInit.Authorization = `Bearer ${opts.token}`;

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: headersInit,
    cache: 'no-store',
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(`${apiBase()}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    const error = new PortalApiError(
      res.status,
      body?.code ?? 'request_failed',
      body?.message ?? `Request failed with status ${res.status}`,
    );
    if (res.status >= 500) throw error;
    return { data: null, error };
  }
  if (res.status === 204) return { data: undefined as unknown as TResponse, error: null };
  try {
    return { data: (await res.json()) as TResponse, error: null };
  } catch {
    throw new PortalApiError(res.status, 'malformed_response', 'Failed to parse response');
  }
}
