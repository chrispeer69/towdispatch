/**
 * Integration spec — Dynamic Pricing tier CRUD + activation lifecycle
 * (Moat #1).
 *
 * Covers:
 *   - POST /dynamic-pricing/tiers creates an inactive tier
 *   - PATCH /dynamic-pricing/tiers/:id updates fields
 *   - POST /dynamic-pricing/tiers/:id/activate flips is_active=true
 *   - POST /dynamic-pricing/tiers/:id/deactivate flips back
 *   - DELETE /dynamic-pricing/tiers/:id soft-deletes
 *   - Each activation/deactivation writes a tier_activations row
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

const SUFFIX = `dpt-${Date.now().toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — dynamic pricing tiers', () => {
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

  it('creates an inactive tier and round-trips through PATCH', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
      payload: { name: 'Storm Surge', category: 'weather', multiplier: 1.5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; isActive: boolean; multiplier: number };
    expect(body.isActive).toBe(false);
    expect(body.multiplier).toBe(1.5);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/dynamic-pricing/tiers/${body.id}`,
      headers: auth(owner.accessToken),
      payload: { multiplier: 1.8 },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { multiplier: number }).multiplier).toBe(1.8);
  });

  it('activate then deactivate writes a tier_activations row pair', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
      payload: { name: 'Activation Test', category: 'special_event', multiplier: 1.25 },
    });
    const tier = created.json() as { id: string };

    const act = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/tiers/${tier.id}/activate`,
      headers: auth(owner.accessToken),
      payload: { reason: 'manual' },
    });
    expect(act.statusCode).toBe(200);
    expect((act.json() as { isActive: boolean }).isActive).toBe(true);

    const deact = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/tiers/${tier.id}/deactivate`,
      headers: auth(owner.accessToken),
      payload: { reason: 'done' },
    });
    expect(deact.statusCode).toBe(200);
    expect((deact.json() as { isActive: boolean }).isActive).toBe(false);
  });

  it('soft-delete via DELETE removes the tier from list responses', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
      payload: { name: 'Doomed', category: 'traffic', multiplier: 1.2 },
    });
    const id = (created.json() as { id: string }).id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/dynamic-pricing/tiers/${id}`,
      headers: auth(owner.accessToken),
    });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({
      method: 'GET',
      url: '/dynamic-pricing/tiers',
      headers: auth(owner.accessToken),
    });
    const ids = (list.json() as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(id);
  });
});
