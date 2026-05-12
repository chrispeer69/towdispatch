/**
 * Tiny direct-to-API client for fixture seeding. Bypasses the web UI so
 * setup is fast and deterministic.
 *
 * The API base URL comes from API_E2E_BASE_URL, defaulting to the port the
 * apps/web e2e bootstrap uses so the two suites can share a docker stack.
 */
const API_BASE = process.env.API_E2E_BASE_URL ?? 'http://localhost:3601';

export interface SignedUpSession {
  status: 'authenticated';
  user: { id: string; email: string };
  tenant: { id: string; slug: string };
  accessToken: string;
  refreshToken: string;
}

export async function apiSignup(body: {
  tenantName: string;
  tenantSlug: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
}): Promise<SignedUpSession> {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SignedUpSession;
}

export async function apiPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function apiGet(path: string, token: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Random suffix for tenant slugs / emails so concurrent runs don't collide. */
export function uniqueSuffix(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
