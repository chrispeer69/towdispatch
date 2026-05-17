/**
 * Integration spec — dynamic pricing cron orchestrators (Moat #1).
 *
 * Drives the auto-revert and demand-surge crons via their public entry
 * points (runForAllTenants / runForTenant). Time mocking via
 * vi.setSystemTime so the auto-revert sees the auto_revert_at row as
 * past-due.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutoRevertService } from '../../src/modules/dynamic-pricing/auto-revert.service.js';
import { DemandSurgeService } from '../../src/modules/dynamic-pricing/demand-surge.service.js';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `dpc-${Date.now().toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — dynamic pricing cron', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('auto-revert deactivates a tier whose auto_revert_at is in the past', async () => {
    // Create a tier scheduled to auto-revert 1 hour ago.
    const created = await app.inject({
      method: 'POST',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
      payload: { name: 'Auto-revert me', category: 'special_event', multiplier: 1.5 },
    });
    const tierId = (created.json() as { id: string }).id;
    await app.inject({
      method: 'PATCH',
      url: `/dynamic-pricing/tiers/${tierId}`,
      headers: auth(owner.accessToken),
      payload: { autoRevertAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    });
    await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/tiers/${tierId}/activate`,
      headers: auth(owner.accessToken),
      payload: {},
    });

    // Drive the cron synchronously.
    const auto = app.get(AutoRevertService);
    const result = await auto.runForTenant(owner.tenant.id);
    expect(result).toBeGreaterThanOrEqual(1);

    // Tier should now be inactive.
    const list = await app.inject({
      method: 'GET',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
    });
    const tiers = list.json() as Array<{ id: string; isActive: boolean }>;
    const t = tiers.find((x) => x.id === tierId);
    expect(t?.isActive).toBe(false);
  });

  it('demand-surge cron does not crash on empty history (returns 0)', async () => {
    const ds = app.get(DemandSurgeService);
    const created = await ds.runForTenant(owner.tenant.id);
    // Fresh tenant with no historical jobs → no suggestions.
    expect(created).toBe(0);
  });
});
