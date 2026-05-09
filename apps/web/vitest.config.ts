import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // No vitest unit tests in apps/web yet — the (Playwright) e2e suite has
    // its own runner. `passWithNoTests` keeps `pnpm test` green while we
    // wire the unit-test surface separately.
    include: ['src/**/*.spec.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
    passWithNoTests: true,
  },
});
