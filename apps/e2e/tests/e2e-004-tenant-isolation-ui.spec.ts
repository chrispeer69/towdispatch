/**
 * E2E-004 — Tenant isolation in the UI.
 *
 * Tenant B's user, logged in, manually visits URLs that contain a Tenant
 * A record ID. Every route renders 404 — never a leak, never a 403,
 * never the data.
 *
 * The API-tier RLS bypass test (Session 17A's
 * apps/api/test/security/rls-bypass.spec.ts) verifies the underlying
 * endpoints already return 404. This test makes sure the web pages also
 * surface that as "not found" UI rather than a stack trace or a blank
 * page.
 */
import { expect, test } from '@playwright/test';
import { apiPost, apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

test.describe('E2E-004 tenant isolation in the UI', () => {
  test.beforeAll(skipIfNoStack);

  test('tenant B cannot view tenant A records by URL guess', async ({ page }) => {
    const aSuffix = uniqueSuffix('e2e4a');
    const bSuffix = uniqueSuffix('e2e4b');

    const a = await apiSignup({
      tenantName: `Tenant A ${aSuffix}`,
      tenantSlug: aSuffix,
      ownerName: 'Owner A',
      ownerEmail: `owner-${aSuffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });
    const b = await apiSignup({
      tenantName: `Tenant B ${bSuffix}`,
      tenantSlug: bSuffix,
      ownerName: 'Owner B',
      ownerEmail: `owner-${bSuffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });

    const aCust = await apiPost('/customers', a.accessToken, {
      type: 'cash',
      name: 'A Customer',
      phone: `+1310555${Math.floor(Math.random() * 9000 + 1000)}`,
      email: `acust-${aSuffix}@spec.test`,
    });
    expect(aCust.ok).toBe(true);
    const aCustomerId = ((await aCust.json()) as { id: string }).id;

    // Log in as B and try to visit A's customer detail page.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(b.user.email);
    await page.getByLabel(/password/i).fill('CorrectHorse-Battery-9!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/dashboard');

    await page.goto(`/customers/${aCustomerId}`);
    // The current customer detail page renders 404 from the server when
    // the API returns 404 — verify the 404 page text is on screen.
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
  });
});
