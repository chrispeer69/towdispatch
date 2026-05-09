/**
 * Console-error capture spec for /intake.
 *
 * Logs everything the browser console emits during a full intake session:
 *   - load /intake (after login)
 *   - blur every required field (so validation errors are exercised)
 *   - submit a known-bad form (DISPATCH disabled but we still try to click)
 *
 * The acceptance gate (Item 3 / Gate 4): after the diagnostic run completes,
 * the console buffer must be empty of "error" and "warning" messages. This
 * spec is the regression guard — once /intake is clean, it stays clean.
 */
import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

interface CapturedMsg {
  type: string;
  text: string;
  url?: string;
  line?: number;
}

function startCapture(page: Page): {
  errors: CapturedMsg[];
  warnings: CapturedMsg[];
  pageErrors: Error[];
  failedRequests: { url: string; failure: string | null }[];
} {
  const errors: CapturedMsg[] = [];
  const warnings: CapturedMsg[] = [];
  const pageErrors: Error[] = [];
  const failedRequests: { url: string; failure: string | null }[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    const captured: CapturedMsg = {
      type: msg.type(),
      text: msg.text(),
    };
    const loc = msg.location();
    if (loc) {
      captured.url = loc.url;
      captured.line = loc.lineNumber;
    }
    if (msg.type() === 'error') errors.push(captured);
    if (msg.type() === 'warning') warnings.push(captured);
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err);
  });

  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? null });
  });

  return { errors, warnings, pageErrors, failedRequests };
}

test.describe('Intake — console clean', () => {
  test('/intake renders without console errors or warnings', async ({ page }) => {
    const cap = startCapture(page);

    // Login first.
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    // Reset capture so noise from /login (e.g. stale-page tear-down) does not
    // pollute the /intake assertion.
    cap.errors.length = 0;
    cap.warnings.length = 0;
    cap.pageErrors.length = 0;
    cap.failedRequests.length = 0;

    // Load /intake.
    await page.goto('/intake');
    await expect(page.getByRole('heading', { name: 'Call Intake' })).toBeVisible();

    // Wait for hydration / debounced quote / autocomplete effects to settle.
    await page.waitForTimeout(2000);

    // Touch the required fields so blur events fire.
    await page.getByTestId('intake-customer-email').focus();
    await page.getByTestId('intake-customer-email').blur();
    await page.getByTestId('intake-vin').focus();
    await page.getByTestId('intake-vin').blur();

    // Open the additional contact info panel — exercises the <details>
    // toggle and any state-dependent layout reflow.
    await page.getByTestId('intake-additional-contact').click();
    await page.waitForTimeout(500);

    // Type a phone — triggers debounced /api/customers/search XHR.
    await page.getByTestId('intake-phone').fill('555-555-1234');
    // Type a plate — triggers /api/vehicles/lookup XHR.
    await page.getByTestId('intake-plate').fill('TEST123');
    await page.locator('input[placeholder="OH"]').first().fill('OH');

    // Quote-preview also auto-fires whenever serviceType/pickup change.
    await page.getByTestId('intake-pickup-address').fill('100 Main St');
    await page.locator('input[placeholder="Lat"]').first().fill('39.9612');
    await page.locator('input[placeholder="Lng"]').first().fill('-82.9988');

    // Wait for the debounced fetches to complete.
    await page.waitForTimeout(2000);

    // Reload — re-runs hydration end-to-end. A stale dev artefact will
    // surface here as a hydration mismatch warning.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Call Intake' })).toBeVisible();
    await page.waitForTimeout(1500);

    // Final settle.
    await page.waitForTimeout(500);

    // -------- assertions --------
    if (cap.errors.length || cap.warnings.length || cap.pageErrors.length) {
      // eslint-disable-next-line no-console
      console.log('[capture] errors:', JSON.stringify(cap.errors, null, 2));
      // eslint-disable-next-line no-console
      console.log('[capture] warnings:', JSON.stringify(cap.warnings, null, 2));
      // eslint-disable-next-line no-console
      console.log(
        '[capture] page errors:',
        cap.pageErrors.map((e) => e.message),
      );
      // eslint-disable-next-line no-console
      console.log('[capture] failedRequests:', JSON.stringify(cap.failedRequests, null, 2));
    }
    expect(cap.pageErrors.map((e) => e.message), 'page errors').toEqual([]);
    expect(cap.errors, 'console errors').toEqual([]);
    expect(cap.warnings, 'console warnings').toEqual([]);
  });
});
