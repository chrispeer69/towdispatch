/**
 * Lighthouse smoke. Runs against the authenticated dashboard AND the
 * dispatch board via playwright-lighthouse. Asserts the headline scores
 * meet the spec: Performance ≥ 80, Accessibility ≥ 95, Best Practices ≥ 90.
 *
 * Gate: runs by default whenever the stack is up (E2E_RUN_REQUIRES_STACK=1).
 * Set E2E_LIGHTHOUSE_SKIP=1 to opt out explicitly — useful on a developer
 * machine without Chrome or when the local Chromium install is broken.
 *
 * Lighthouse needs Chrome started with the remote debugging port flag,
 * which Playwright's bundled `page` doesn't expose. We spawn a separate
 * Chromium instance per test with the flag set, then hand it to playAudit.
 */
import { chromium, expect, test } from '@playwright/test';
import { playAudit } from 'playwright-lighthouse';
import { apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

const THRESHOLDS = {
  performance: 80,
  accessibility: 95,
  'best-practices': 90,
  seo: 0,
  pwa: 0,
} as const;

const BASE = process.env.WEB_E2E_BASE_URL ?? 'http://localhost:3600';

async function signInAndGo(targetPath: string, port: number): Promise<void> {
  const suffix = uniqueSuffix('lh');
  const owner = await apiSignup({
    tenantName: `LH Co ${suffix}`,
    tenantSlug: suffix,
    ownerName: 'LH Owner',
    ownerEmail: `owner-${suffix}@spec.test`,
    password: 'CorrectHorse-Battery-9!',
  });

  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(owner.user.email);
    await page.getByLabel(/password/i).fill('CorrectHorse-Battery-9!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/dashboard');
    if (targetPath !== '/dashboard') await page.goto(`${BASE}${targetPath}`);

    await playAudit({
      page,
      port,
      thresholds: { ...THRESHOLDS },
      reports: {
        formats: { html: false, json: true },
        name: `lh-${targetPath.replace(/[/]/g, '-') || 'root'}`,
        directory: 'playwright-report/lighthouse',
      },
    });
  } finally {
    await browser.close();
  }
}

test.describe('Lighthouse smoke', () => {
  test.beforeAll(skipIfNoStack);
  test.beforeAll(() => {
    test.skip(
      process.env.E2E_LIGHTHOUSE_SKIP === '1',
      'Lighthouse opt-out via E2E_LIGHTHOUSE_SKIP=1.',
    );
  });

  test('dashboard meets perf > 80, a11y > 95, best-practices > 90', async () => {
    await signInAndGo('/dashboard', 9223);
    expect(true).toBe(true);
  });

  test('dispatch board meets perf > 80, a11y > 95, best-practices > 90', async () => {
    await signInAndGo('/dispatch', 9224);
    expect(true).toBe(true);
  });
});
