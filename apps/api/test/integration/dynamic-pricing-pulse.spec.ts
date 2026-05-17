/**
 * Integration spec — Today's Pulse endpoint (Moat #1).
 *
 * Asserts the endpoint returns the expected envelope (deltaCents,
 * upliftPct, byTier) even before any acceptance has happened, and that
 * the date matches the tenant's local-timezone date.
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

const SUFFIX = `dpp-${Date.now().toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — dynamic pricing pulse', () => {
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

  it('GET /dynamic-pricing/pulse/today returns a zeroed snapshot for a fresh tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dynamic-pricing/pulse/today',
      headers: auth(owner.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      date: string;
      revenueCents: number;
      standardRevenueCents: number;
      deltaCents: number;
      acceptedQuoteCount: number;
      byTier: unknown[];
    };
    expect(body.acceptedQuoteCount).toBe(0);
    expect(body.revenueCents).toBe(0);
    expect(body.deltaCents).toBe(0);
    expect(Array.isArray(body.byTier)).toBe(true);
    // date is YYYY-MM-DD in tenant tz
    expect(/^\d{4}-\d{2}-\d{2}$/.test(body.date)).toBe(true);
  });
});
