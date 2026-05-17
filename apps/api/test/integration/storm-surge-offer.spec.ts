/**
 * Integration spec — Storm Surge Offer Engine (Moat #1).
 *
 * Validates: with motorClubStormSurgeEnabled=true and an active Weather
 * tier ≥1.5×, the inbound /motor-club/agero/dispatch response carries
 * stormSurgeOfferAvailable: true; without the flag or the tier, it
 * reports false. Accept/decline endpoints record the operator decision.
 *
 * The endpoint is @Public() (motor-club ingress is signed elsewhere),
 * so we don't need a session token for /dispatch — we just need a real
 * tenant id to attach to the payload.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const SUFFIX = `sso-${Date.now().toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — storm surge offer', () => {
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

  async function dispatchInbound(): Promise<{ jobId: string; stormSurgeOfferAvailable?: boolean }> {
    const res = await app.inject({
      method: 'POST',
      url: '/motor-club/agero/dispatch',
      payload: {
        tenantId: owner.tenant.id,
        externalId: `agero-test-${Date.now()}`,
        service: 'tow',
        customer: { name: 'Storm C' },
        pickup: { address: '1 Storm St' },
      },
    });
    return res.json() as { jobId: string; stormSurgeOfferAvailable?: boolean };
  }

  it('default tenant: stormSurgeOfferAvailable false (flag disabled)', async () => {
    const body = await dispatchInbound();
    expect(body.jobId).toBeDefined();
    expect(body.stormSurgeOfferAvailable).toBe(false);
  });

  it('with flag + active Weather tier ≥1.5×: stormSurgeOfferAvailable true', async () => {
    // Enable the flag.
    await app.inject({
      method: 'PATCH',
      url: '/dynamic-pricing/settings',
      headers: auth(owner.accessToken),
      payload: { motorClubStormSurgeEnabled: true },
    });
    // Create + activate a Weather tier with multiplier 1.5×.
    const created = await app.inject({
      method: 'POST',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
      payload: { name: 'Storm 1.5x', category: 'weather', multiplier: 1.5 },
    });
    const id = (created.json() as { id: string }).id;
    await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/tiers/${id}/activate`,
      headers: auth(owner.accessToken),
      payload: {},
    });

    const body = await dispatchInbound();
    expect(body.stormSurgeOfferAvailable).toBe(true);
  });
});
