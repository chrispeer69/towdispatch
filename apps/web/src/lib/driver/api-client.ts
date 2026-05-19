'use client';

/**
 * driverApi — single client-side fetch wrapper for the in-truck app.
 *
 * Why a fresh client instead of reusing apps/web/src/lib/api/client.ts:
 * the operator client is built around Next.js server-side cookies()
 * reads and the BFF refresh-on-401 dance. The driver session is
 * a plain bearer token in localStorage, requested directly from the
 * driver's browser against the public API hostname. No cookies, no
 * refresh — when the 12h JWT expires, the driver re-PINs.
 *
 * The wrapper:
 *   - attaches `Authorization: Bearer <jwt>` from DRIVER_JWT_KEY
 *   - JSON-encodes the body and parses JSON responses
 *   - throws DriverApiError with structured fields on non-2xx
 *   - on 401, clears the driver session so the gate redirects to login
 *
 * Mutating calls (POST/PATCH/DELETE) that fail with a network error
 * are not retried here — the offline queue handles that at a different
 * layer (see driver-offline-queue.ts).
 */
import { DRIVER_JWT_KEY, DRIVER_PROFILE_KEY } from './storage-keys';

export class DriverApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DriverApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class DriverOfflineError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'DriverOfflineError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Resolves the API base URL. Mirrors the operator client's fallback
 * chain but only the browser-visible variable matters here — the driver
 * web app never runs server-side fetches.
 */
export function driverApiBase(): string {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<
    string,
    string | undefined
  >;
  // Order of resolution:
  //   1. NEXT_PUBLIC_API_URL when baked into the bundle (preferred).
  //   2. Smart fallback: when running on the production hostname, point
  //      to the production API explicitly. Survives misconfigured
  //      build envs where the var didn't bake in (Railway has a known
  //      quirk with NEXT_PUBLIC_* vars in Dockerfile builds).
  //   3. Local-dev fallback when window is undefined or hostname is
  //      localhost.
  if (env.NEXT_PUBLIC_API_URL) return env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'app.towcommand.cloud') return 'https://api.towcommand.cloud';
    if (host.endsWith('.towcommand.cloud')) {
      // Future-proofs preview / staging subdomains by mirroring the API
      // subdomain (app.foo → api.foo).
      return `https://api.${host.split('.').slice(1).join('.')}`;
    }
  }
  return 'http://localhost:3001';
}

export function readDriverJwt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DRIVER_JWT_KEY);
  } catch {
    return null;
  }
}

export function clearDriverSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRIVER_JWT_KEY);
    window.localStorage.removeItem(DRIVER_PROFILE_KEY);
  } catch {
    // private-mode storage failures are non-fatal
  }
}

interface DriverApiOptions {
  /** Override the JWT lookup; useful for the login call (no JWT yet). */
  jwt?: string | null;
  /** Default false. Set true for endpoints that don't need auth (list-drivers, login). */
  anonymous?: boolean;
  /** Used only for finalize-evidence S3 PUTs — bypass JSON encoding/parsing. */
  raw?: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Core wrapper. Returns parsed JSON for non-raw responses.
 */
export async function driverApi<TResponse = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts: DriverApiOptions = {},
): Promise<TResponse> {
  const base = driverApiBase();
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const headers: Record<string, string> = {};
  if (!opts.anonymous) {
    const jwt = opts.jwt !== undefined ? opts.jwt : readDriverJwt();
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
  }
  if (body !== undefined && !opts.raw) {
    headers['content-type'] = 'application/json';
  }

  let res: Response;
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = opts.raw ? (body as BodyInit) : JSON.stringify(body);
    if (opts.signal) init.signal = opts.signal;
    res = await fetch(url, init);
  } catch (err) {
    // fetch() throws on network failure or aborted request. We rebadge
    // network failures so the queue can distinguish offline from 4xx/5xx.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new DriverOfflineError((err as Error).message);
  }

  if (!res.ok) {
    if (res.status === 401) clearDriverSession();
    let code = 'unknown';
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const parsed = (await res.json()) as { code?: string; message?: string; details?: unknown };
      if (parsed?.code) code = parsed.code;
      if (parsed?.message) message = parsed.message;
      details = parsed?.details;
    } catch {
      // non-JSON error response — keep the defaults
    }
    throw new DriverApiError(res.status, code, message, details);
  }

  if (res.status === 204) return undefined as TResponse;
  if (opts.raw) return res as unknown as TResponse;
  return (await res.json()) as TResponse;
}
