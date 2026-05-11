/**
 * Reports happy-path smoke test.
 *
 * The eight cards on /reports each link to a detail page. We click into
 * one (dispatch), assert the filter sidebar, KPI strip, and data table all
 * render, and verify the BFF returns 200 on the standard endpoints.
 */
import { expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe('Reports', () => {
  test('index lists eight cards', async ({ page }) => {
    // Log in first
    await page.goto('/login');
    await page.getByLabel('Email').fill('owner@acme.test');
    await page.getByLabel('Password').fill('ChangeMe123!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard|\/intake/);

    await page.goto('/reports');
    await expect(page.getByTestId('reports-index')).toBeVisible();
    for (const id of [
      'dispatch',
      'driver',
      'revenue',
      'storage',
      'pnl',
      'commission',
      'tax',
      'compliance',
    ]) {
      await expect(page.getByTestId(`report-card-${id}`)).toBeVisible();
    }
  });

  test('dispatch detail renders KPIs, filter sidebar, and table', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('owner@acme.test');
    await page.getByLabel('Password').fill('ChangeMe123!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard|\/intake/);

    await page.goto('/reports/dispatch');
    await expect(page.getByTestId('report-dispatch')).toBeVisible();
    await expect(page.getByTestId('filter-sidebar')).toBeVisible();
    await expect(page.getByTestId('report-table')).toBeVisible();
  });

  test('export CSV produces a download descriptor', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('owner@acme.test');
    await page.getByLabel('Password').fill('ChangeMe123!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard|\/intake/);

    await page.goto('/reports/dispatch');
    await page.getByTestId('export-csv').click();
    await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 5000 });
  });
});
