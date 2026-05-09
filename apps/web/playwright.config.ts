import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.WEB_E2E_PORT ?? 3500);
const baseURL = `http://localhost:${PORT}`;

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
  webServer: {
    command: `next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
      API_PUBLIC_URL: process.env.API_PUBLIC_URL ?? 'http://localhost:3001',
      NEXT_PUBLIC_WEB_URL: baseURL,
      NODE_ENV: 'development',
    },
  },
});
