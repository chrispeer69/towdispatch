/**
 * Playwright config for the dedicated @towdispatch/e2e package.
 *
 * The existing apps/web/e2e/ smoke suite stays put — it covers in-tree
 * walkthroughs (intake, dispatch, fleet) tied to specific session
 * acceptance demos. This package owns the user-journey suite that runs
 * in CI on every PR.
 *
 * Ports are isolated from apps/web/e2e so both can run in parallel
 * locally without colliding.
 *
 *   WEB_E2E_BASE_URL — point at an already-running web server, OR let
 *                       Playwright spawn the web + api dev servers itself.
 *   E2E_RUN_REQUIRES_STACK — set to "1" to actually start the test run;
 *                       otherwise tests skip with a helpful message so
 *                       `pnpm --filter @towdispatch/e2e test` is safe to
 *                       run on developer machines without docker.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.WEB_E2E_BASE_URL ?? 'http://localhost:3600';
const isCi = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  ...(isCi ? { workers: 2 } : {}),
  reporter: isCi
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'playwright-report/junit.xml' }],
        ['github'],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox + WebKit on main only — guarded by an env flag the CI
    // workflow flips per branch.
    ...(process.env.E2E_FULL_BROWSER_MATRIX === '1'
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
