import { defineConfig } from 'vitest/config';

/**
 * Root vitest project — covers ONLY the repo-root compliance scripts
 * (scripts/compliance/*.spec.ts). The app/package suites run under their own
 * configs via `pnpm -r run test`; the root `test` script chains this after them.
 *
 * Scoped deliberately to scripts/** so it never picks up apps/* or packages/*
 * specs (those need the SWC/decorator-metadata pipeline this config omits — the
 * compliance collectors are plain TS with no decorators, so esbuild is enough).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.spec.ts'],
  },
});
