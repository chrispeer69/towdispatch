/**
 * E2E-013 — Capacity-Aware Dispatch Signaling (CADS, Session 58).
 *
 * Browser proof of the operator surface:
 *   1. The Capacity Signal widget renders live state on the dispatch board
 *      (blended gauge + per-class gauges; a fresh tenant with no drivers
 *      shows every class OFFLINE — the zero-driver rule, not divide-by-zero).
 *   2. Manual override set + clear flows work from the widget (banner with
 *      reason + expiry appears, blended pill flips, clear resumes computed).
 *   3. The Capacity Signaling settings page saves threshold changes.
 *
 * The manual walkthrough version of this script lives at
 * docs/cads-walkthrough.md.
 */
import { expect, test } from '@playwright/test';
import { apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

const PASSWORD = 'CorrectHorse-Battery-9!';

test.describe('E2E-013 capacity signaling', () => {
  test.beforeAll(skipIfNoStack);

  test('widget renders live state, override set/clear works, settings save', async ({ page }) => {
    const suffix = uniqueSuffix('e2e13');
    const session = await apiSignup({
      tenantName: `CADS ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Cads Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: PASSWORD,
    });

    // ---- login through the real UI ----
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(session.user.email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/dashboard');

    // ---- 1. widget renders live state on the dispatch board ----
    await page.goto('/dispatch');
    const panel = page.getByTestId('capacity-signal');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Capacity Signal')).toBeVisible();

    // Fresh tenant: no drivers on shift => blended + every class OFFLINE.
    const blended = page.getByTestId('capacity-blended');
    await expect(blended).toBeVisible();
    await expect(blended).toContainText('0 drivers');
    await expect(blended).toContainText(/offline/i);
    for (const cls of ['light', 'medium', 'heavy']) {
      const gauge = page.getByTestId(`capacity-class-${cls}`);
      await expect(gauge).toBeVisible();
      await expect(gauge).toContainText(/offline/i);
    }
    await expect(panel).toContainText(/last broadcast/i);

    // ---- 2. override set flow ----
    await page.getByTestId('capacity-set-override').click();
    await expect(page.getByText('Force capacity status')).toBeVisible();
    await page.locator('#override-class').selectOption('all');
    await page.locator('#override-band').selectOption('at_capacity');
    await page.locator('#override-reason').fill('E2E storm mode — every truck committed');
    await page.locator('#override-duration').selectOption('60');
    await page.getByRole('button', { name: /force status/i }).click();

    const banner = page.getByTestId('capacity-override-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('E2E storm mode — every truck committed');
    // Blended gauge now carries the forced band + override marker.
    await expect(blended).toContainText(/at capacity/i);
    await expect(blended).toContainText('(override)');

    // ---- 2b. override clear flow ----
    await banner.getByRole('button', { name: /^clear$/i }).click();
    await expect(banner).toBeHidden();
    await expect(blended).toContainText(/offline/i);

    // ---- 3. settings save ----
    await page.goto('/settings/capacity');
    await expect(page.getByRole('heading', { name: /capacity/i }).first()).toBeVisible();
    const guideline = page.locator('#cap-guideline');
    await expect(guideline).toHaveValue('60');
    await guideline.fill('45');
    await page.getByRole('button', { name: /save thresholds/i }).click();
    // Persisted server-side: a full reload comes back with 45.
    await page.reload();
    await expect(page.locator('#cap-guideline')).toHaveValue('45');
  });
});
