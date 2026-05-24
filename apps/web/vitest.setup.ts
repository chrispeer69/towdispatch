/**
 * Global Vitest setup.
 *
 *  - Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.).
 *  - Shims React's `cache`. React 18.3.1's default (client) build does not
 *    export `cache`; Next.js supplies it in production through the
 *    `react-server` export condition. Vitest resolves the client build, so
 *    modules that call `cache(...)` at import time (lib/auth/cookies.ts via
 *    lib/api/client.ts) would crash with "cache is not a function". Request
 *    memoization is meaningless in unit tests, so an identity passthrough is
 *    the correct shim — and we spread the real module so every other React
 *    export (hooks, internals used by react-dom / @testing-library) is
 *    untouched.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  if (typeof (actual as { cache?: unknown }).cache === 'function') return actual;
  return {
    ...actual,
    cache: <T>(fn: T): T => fn,
  };
});
