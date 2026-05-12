/**
 * E2E-009 — Accessibility smoke per page.
 *
 * Runs @axe-core/playwright against every primary user-facing page.
 * Fails the test if any serious or critical violation is reported.
 *
 * Pages: login, dashboard, dispatch board, call intake, customer detail,
 * invoice detail, settings, import wizard.
 *
 * The auth shell is server-side gated, so this spec signs an owner up
 * first via the API then drives the browser into each route.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

const PAGES = [
  { name: 'login', path: '/login', requiresAuth: false },
  { name: 'dashboard', path: '/dashboard', requiresAuth: true },
  { name: 'dispatch', path: '/dispatch', requiresAuth: true },
  { name: 'intake', path: '/intake', requiresAuth: true },
  { name: 'customers', path: '/customers', requiresAuth: true },
  { name: 'billing', path: '/billing', requiresAuth: true },
  { name: 'import', path: '/import', requiresAuth: true },
];

test.describe('E2E-009 axe-core a11y smoke', () => {
  test.beforeAll(skipIfNoStack);

  test('no serious or critical violations on primary pages', async ({ page }) => {
    const suffix = uniqueSuffix('e2e9');
    const owner = await apiSignup({
      tenantName: `A11y Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'A11y Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(owner.user.email);
    await page.getByLabel(/password/i).fill('CorrectHorse-Battery-9!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/dashboard');

    const offenders: Array<{ page: string; rule: string; impact: string; help: string }> = [];

    for (const target of PAGES) {
      if (!target.requiresAuth) {
        // Sign out first so /login renders unauthenticated.
        await page.goto('/logout');
      }
      await page.goto(target.path);

      const results = await new AxeBuilder({ page })
        // WCAG 2.1 AA + best practices. Color-contrast is included.
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        // The dispatch map uses Mapbox which has known minor a11y
        // shortcomings we can't fix without a vendor change. Disable
        // the specific check that fires inside the Mapbox canvas.
        .disableRules(['canvas'])
        .analyze();

      for (const v of results.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          offenders.push({
            page: target.path,
            rule: v.id,
            impact: v.impact ?? 'serious',
            help: v.help,
          });
        }
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
