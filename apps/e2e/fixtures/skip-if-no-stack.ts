/**
 * Skip the entire test file when the live web + api stack isn't available.
 *
 * Without this guard, `pnpm --filter @towcommand/e2e test` would fail
 * immediately on a developer machine that hasn't booted docker. The CI
 * workflow sets E2E_RUN_REQUIRES_STACK=1 explicitly to opt in.
 *
 * Usage at the top of a spec:
 *
 *     import { skipIfNoStack } from '../fixtures/skip-if-no-stack';
 *     test.beforeAll(skipIfNoStack);
 */
import { test } from '@playwright/test';

export const stackEnabled = process.env.E2E_RUN_REQUIRES_STACK === '1';

export async function skipIfNoStack(): Promise<void> {
  test.skip(
    !stackEnabled,
    'Live web + api stack required. Set E2E_RUN_REQUIRES_STACK=1 to opt in.',
  );
}
