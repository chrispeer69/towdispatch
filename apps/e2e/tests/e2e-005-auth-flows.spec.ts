/**
 * E2E-005 — Auth flows (real).
 *
 *   1. Signup creates tenant + OWNER → AuthenticatedResponse with tokens
 *   2. Login (MFA wall disabled — MFA_LOGIN_GATE_ENABLED=false by default):
 *      re-login as OWNER returns status='authenticated' with tokens.
 *   3. Refresh token rotation: fresh refresh works; replay of the
 *      rotated-out token fails
 *   4. Forgot-password is enumeration-safe (real + unknown emails both
 *      return 2xx)
 */
import { expect, test } from '@playwright/test';
import { apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

const API_BASE = process.env.API_E2E_BASE_URL ?? 'http://localhost:3601';

test.describe('E2E-005 auth flows', () => {
  test.beforeAll(skipIfNoStack);

  test('OWNER login returns authenticated tokens (MFA wall disabled)', async () => {
    const suffix = uniqueSuffix('e2e5');
    const owner = await apiSignup({
      tenantName: `Auth Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Auth Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });
    expect(owner.status).toBe('authenticated');

    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: owner.user.email,
        password: 'CorrectHorse-Battery-9!',
      }),
    });
    expect(loginRes.ok).toBe(true);
    const body = (await loginRes.json()) as {
      status: string;
      accessToken?: string;
      refreshToken?: string;
      setupToken?: string;
    };
    expect(body.status).toBe('authenticated');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.setupToken).toBeUndefined();
  });

  test('refresh token rotation invalidates the rotated-out token', async () => {
    const suffix = uniqueSuffix('e2e5r');
    const owner = await apiSignup({
      tenantName: `Refresh Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Refresh Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });

    const first = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: owner.refreshToken }),
    });
    expect(first.ok).toBe(true);
    const firstBody = (await first.json()) as { refreshToken: string };
    expect(firstBody.refreshToken).not.toBe(owner.refreshToken);

    const replay = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: owner.refreshToken }),
    });
    expect(replay.ok).toBe(false);
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  test('forgot-password is enumeration-safe', async () => {
    const suffix = uniqueSuffix('e2e5f');
    const owner = await apiSignup({
      tenantName: `Forgot Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Forgot Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });

    const real = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: owner.user.email }),
    });
    expect(real.ok).toBe(true);

    const unknown = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `nobody-${suffix}@spec.test` }),
    });
    expect(unknown.ok).toBe(true);
  });
});
