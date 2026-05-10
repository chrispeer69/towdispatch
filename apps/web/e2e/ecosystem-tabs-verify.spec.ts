/**
 * Regression guard for the ECOSYSTEM sidebar brand-color treatment.
 *
 * Asserts computed styles from a real Chromium render so that pure-HTML
 * grep tests in scripts/verify-ecosystem-tabs.sh can't be subverted by
 * a Tailwind purge, CSS-variable rename, or stylesheet override that
 * still leaves the inline-style values in markup.
 *
 * Spec (locked):
 * - Icon: brand-colored at all times (active + inactive)
 * - Text: default sidebar color when inactive, brand when active
 * - Active: 8% brand bg + 3px brand left-edge bar + brand text
 * - Hover (inactive): 4% brand bg, no text color change
 *
 * Logs in as the seeded acme owner — signup-via-throttler would limit
 * how many times this can run against the dev DB.
 */
import { type Page, expect, test } from '@playwright/test';

interface Tab {
  label: string;
  href: string;
  hex: string;
  rgb: string;
  rgbParts: { r: number; g: number; b: number };
}

const TABS: Tab[] = (
  [
    { label: 'CONVINI', href: '/ecosystem/convini', hex: '#0F9D58' },
    { label: 'FleetCommand', href: '/ecosystem/fleetcommand', hex: '#1E88E5' },
    { label: 'FleetGuard Pro', href: '/ecosystem/fleetguard', hex: '#F59E0B' },
  ] as const
).map((t) => {
  const r = Number.parseInt(t.hex.slice(1, 3), 16);
  const g = Number.parseInt(t.hex.slice(3, 5), 16);
  const b = Number.parseInt(t.hex.slice(5, 7), 16);
  return { ...t, rgb: `rgb(${r}, ${g}, ${b})`, rgbParts: { r, g, b } };
});

async function loginAsAcmeOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[autocomplete="email"]', 'owner@acme.test');
  await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/(app|dashboard)/);
}

test.describe('Ecosystem sidebar brand colors', () => {
  test('icons branded everywhere; text + bg + indicator branded only when active; 4% bg on hover', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginAsAcmeOwner(page);

    // ---------- INACTIVE STATE — /dashboard ----------
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    for (const tab of TABS) {
      const link = page.locator(`a[href="${tab.href}"]`);
      await expect(link, `${tab.label} link visible`).toBeVisible();

      const iconColor = await link
        .locator('svg')
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(iconColor, `${tab.label} icon color (inactive)`).toBe(tab.rgb);

      const labelColor = await link
        .locator('span', { hasText: tab.label })
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(labelColor, `${tab.label} text (inactive should NOT be brand)`).not.toBe(tab.rgb);

      const bg = await link.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, `${tab.label} bg (inactive should be transparent)`).toBe('rgba(0, 0, 0, 0)');
    }

    // ---------- HOVER — CONVINI (one tab is enough; same code path) ----------
    const conviniTab = TABS[0];
    if (!conviniTab) throw new Error('TABS[0] missing');
    const convini = page.locator(`a[href="${conviniTab.href}"]`);
    await convini.hover();
    // Allow Tailwind transition-colors to settle.
    await page.waitForTimeout(250);
    const hoverBg = await convini.evaluate((el) => getComputedStyle(el).backgroundColor);
    // 0x0A/255 ≈ 0.0392 → CSS rounds to 0.04.
    expect(hoverBg, 'CONVINI hover bg ≈ rgba(15,157,88, 0.04)').toMatch(
      /^rgba\(15, 157, 88, 0\.0[34]\d*\)$/,
    );

    // ---------- ACTIVE STATE — visit each ecosystem page ----------
    for (const tab of TABS) {
      await page.goto(tab.href, { waitUntil: 'domcontentloaded' });

      const link = page.locator(`a[href="${tab.href}"]`);
      await expect(link, `${tab.label} link visible on active page`).toBeVisible();

      const bg = await link.evaluate((el) => getComputedStyle(el).backgroundColor);
      const { r, g, b } = tab.rgbParts;
      expect(bg, `${tab.label} active bg ≈ ${tab.hex} @ 8%`).toMatch(
        new RegExp(`^rgba\\(${r}, ${g}, ${b}, 0\\.0[78]\\d*\\)$`),
      );

      const labelColor = await link
        .locator('span', { hasText: tab.label })
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(labelColor, `${tab.label} active text color`).toBe(tab.rgb);

      const indicator = link.locator('span[aria-hidden]').first();
      await expect(indicator, `${tab.label} active indicator visible`).toBeVisible();
      const indicatorStyle = await indicator.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { width: cs.width, bg: cs.backgroundColor };
      });
      expect(indicatorStyle.width, `${tab.label} indicator width = 3px`).toBe('3px');
      expect(indicatorStyle.bg, `${tab.label} indicator bg = brand`).toBe(tab.rgb);

      const iconColor = await link
        .locator('svg')
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(iconColor, `${tab.label} active icon color`).toBe(tab.rgb);
    }
  });
});
