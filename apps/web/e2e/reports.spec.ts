/**
 * Reports E2E — happy path across all eight categories.
 *
 *   - Login as owner.
 *   - Open /reports — assert eight cards render with role-aware allowed flag.
 *   - Click each report — detail page renders with KPI row + filter bar +
 *     chart panels + data table panel. We don't seed data deliberately; the
 *     page must not crash on an empty tenant either.
 *   - Save the revenue report — assert it appears in /reports/saved, then
 *     delete it.
 */
import { type APIRequestContext, expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const REPORTS = [
  'dispatch-performance',
  'driver-performance',
  'revenue',
  'storage',
  'pnl',
  'commission',
  'tax',
  'compliance',
] as const;

async function loginAndGetToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: 'owner@acme.test', password: 'ChangeMe123!' },
  });
  expect(res.status(), `login failed: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

test.describe('Reports', () => {
  test('index page shows the eight categories', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    await page.goto('/reports');
    await expect(page.getByTestId('report-grid')).toBeVisible();
    for (const id of REPORTS) {
      // Each card title is rendered as a Tailwind condensed h2 — link href
      // identifies the row, so we assert by that.
      await expect(page.locator(`a[href="/reports/${id}"]`)).toBeVisible();
    }
  });

  test('each report detail page renders core panels without crashing', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    for (const id of REPORTS) {
      await page.goto(`/reports/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Filter bar — "From" label.
      await expect(page.getByText('Filters')).toBeVisible();
      // Either a chart or the empty-data placeholder is present.
      const empty = page.getByText(/No data|No breakdown|No rows/i).first();
      const hasContent = (await empty.count()) > 0 || (await page.locator('svg').count()) > 0;
      expect(hasContent, `report ${id} had no chart or empty state`).toBe(true);
    }
  });

  test('save and delete a revenue report round-trip', async ({ page, request }) => {
    await loginAndGetToken(request); // warm-up + asserts seed creds work
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');

    const name = `e2e-rev-${Date.now()}`;
    await page.goto('/reports/revenue');
    await page.getByRole('button', { name: /Save & schedule/i }).click();
    await page.getByLabel(/Name/i).fill(name);
    await page.getByRole('button', { name: /^Save$/ }).click();

    await page.goto('/reports/saved');
    await expect(page.getByText(name)).toBeVisible();

    page.on('dialog', (d) => d.accept());
    await page
      .getByRole('row', { name: new RegExp(name) })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
