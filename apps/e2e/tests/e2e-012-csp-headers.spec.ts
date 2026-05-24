/**
 * E2E-012 — Content-Security-Policy (R-12).
 *
 * Confirms the web frontend serves the CSP header and that the public login
 * page renders without tripping any CSP violation in a real browser. The login
 * page is the right probe: it exercises the inline anti-flash theme <script>,
 * Next's inline bootstrap, the self-hosted font, and brand imagery — exactly
 * the surfaces 'unsafe-inline' / img-src / font-src have to allow.
 *
 * `next start` (how the e2e + prod servers run) emits the policy; `next dev`
 * does not (see next.config.mjs), so this only runs against the started stack.
 */
import { expect, test } from '@playwright/test';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

test.describe('E2E-012 CSP headers', () => {
  test.beforeAll(skipIfNoStack);

  test('serves a locked-down CSP and /login raises no violations', async ({ page }) => {
    // Capture violations two ways: Chromium's "Refused to…" console errors and
    // the securitypolicyviolation DOM event (collected into a window array we
    // read after load — avoids logging from inside the page).
    const consoleViolations: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/content security policy|violates the following/i.test(text)) {
        consoleViolations.push(text);
      }
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __cspViolations: string[] };
      w.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        w.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
      });
    });

    const response = await page.goto('/login');
    const csp = response?.headers()['content-security-policy'] ?? '';

    expect(csp, 'CSP header should be present on /login').not.toBe('');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');

    // Wait for hydration so any deferred inline script / asset has loaded.
    await page.getByRole('button', { name: /sign in/i }).waitFor();
    await page.waitForTimeout(500);

    const domViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    );
    const all = [...consoleViolations, ...domViolations];
    expect(all, `Unexpected CSP violations:\n${all.join('\n')}`).toEqual([]);
  });
});
