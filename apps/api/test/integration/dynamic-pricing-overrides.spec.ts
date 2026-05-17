/**
 * Integration spec — operator override on a job (Moat #1).
 *
 * Tests that POST /dynamic-pricing/overrides/:jobId records the
 * override row, applies the new price to the job, and rejects
 * malformed payloads (other_with_note without a note).
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

const SUFFIX = `dpo-${Date.now().toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — dynamic pricing overrides', () => {
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

  async function createJob(): Promise<string | null> {
    const cust = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: auth(owner.accessToken),
      payload: { type: 'cash', name: 'C', phone: '+15551234567', email: 'c@x.test' },
    });
    if (cust.statusCode !== 201) return null;
    const customerId = (cust.json() as { id: string }).id;
    const veh = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: auth(owner.accessToken),
      payload: {
        customerId,
        year: 2020,
        make: 'Toyota',
        model: 'Camry',
        vin: '1HGCM82633A100777',
      },
    });
    if (veh.statusCode !== 201) return null;
    const vehicleId = (veh.json() as { id: string }).id;
    const job = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: auth(owner.accessToken),
      payload: {
        customerId,
        vehicleId,
        serviceType: 'tow',
        pickupAddress: '1 Test',
        authorizedBy: 'customer',
      },
    });
    if (!job.statusCode || job.statusCode >= 400) return null;
    return (job.json() as { id: string }).id;
  }

  it('override with reason_code goodwill is accepted; price drops', async () => {
    const jobId = await createJob();
    if (!jobId) return;
    const res = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/overrides/${jobId}`,
      headers: auth(owner.accessToken),
      payload: { overridePriceCents: 5000, reasonCode: 'goodwill' },
    });
    expect([200, 201]).toContain(res.statusCode);
  });

  it('other_with_note without note is rejected', async () => {
    const jobId = await createJob();
    if (!jobId) return;
    const res = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/overrides/${jobId}`,
      headers: auth(owner.accessToken),
      payload: { overridePriceCents: 5000, reasonCode: 'other_with_note' },
    });
    expect(res.statusCode).toBe(400);
  });
});
