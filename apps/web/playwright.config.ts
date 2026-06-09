import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.WEB_E2E_PORT ?? 3500);
const API_PORT = Number(process.env.API_E2E_PORT ?? 3505);
const baseURL = `http://localhost:${PORT}`;
const apiURL = `http://localhost:${API_PORT}`;

// Make the dedicated e2e API URL visible to the test runner process itself
// so any `process.env.NEXT_PUBLIC_API_URL` reads inside the spec resolve to
// the playwright-managed API rather than whatever dev server happens to be
// on :3001.
process.env.NEXT_PUBLIC_API_URL = apiURL;
process.env.API_PUBLIC_URL = apiURL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  // We run BOTH the API and the web on dedicated e2e ports so the suite
  // never collides with whatever dev API is running on :3001 (e.g. the
  // companion Session 4.5 worktree). Both share the same docker Postgres /
  // Redis since they're isolated by tenant_id at the data layer.
  webServer: [
    {
      command: 'pnpm --filter @towdispatch/api run dev',
      url: `${apiURL}/auth/me`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_PORT: String(API_PORT),
        API_HOST: '0.0.0.0',
        NODE_ENV: 'development',
      },
      // /auth/me returns 401 without a token — playwright treats any
      // response as "up", so 401 still satisfies the readiness check.
      ignoreHTTPSErrors: true,
    },
    {
      command: `next dev -p ${PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: apiURL,
        API_PUBLIC_URL: apiURL,
        NEXT_PUBLIC_WEB_URL: baseURL,
        NODE_ENV: 'development',
      },
    },
  ],
});
