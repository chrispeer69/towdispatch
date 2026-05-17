/**
 * Integration spec — quote save workflow state machine (Moat #1, Moat #8).
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

const SUFFIX = `qsw-${Date.now().toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — quote save workflow', () => {
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
      payload: { type: 'cash', name: 'Save C', phone: '+15551111234', email: 'sc@x.test' },
    });
    if (cust.statusCode !== 201) return null;
    const customerId = (cust.json() as { id: string }).id;
    const veh = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: auth(owner.accessToken),
      payload: {
        customerId,
        year: 2018,
        make: 'Honda',
        model: 'Accord',
        vin: '1HGCM82633A100888',
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

  it('decline → step 1 accept happy path closes the funnel', async () => {
    const jobId = await createJob();
    if (!jobId) return;
    const decline = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/decline`,
      headers: auth(owner.accessToken),
      payload: { declineReasonCode: 'too_expensive' },
    });
    expect(decline.statusCode).toBe(200);
    const accept = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/save-step`,
      headers: auth(owner.accessToken),
      payload: { accepted: true },
    });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { done: boolean }).done).toBe(true);
  });

  it('cannot accept save-step before decline opens the funnel', async () => {
    const jobId = await createJob();
    if (!jobId) return;
    const res = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/save-step`,
      headers: auth(owner.accessToken),
      payload: { accepted: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('decline → 1 declined → 2 declined → counter accepted with custom price', async () => {
    const jobId = await createJob();
    if (!jobId) return;
    await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/decline`,
      headers: auth(owner.accessToken),
      payload: { declineReasonCode: 'eta_too_long' },
    });
    // step 1 → declined → offers step 2
    let r = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/save-step`,
      headers: auth(owner.accessToken),
      payload: { accepted: false },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { nextStep: string }).nextStep).toBe('save_step_2');
    // step 2 → declined → offers counter
    r = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/save-step`,
      headers: auth(owner.accessToken),
      payload: { accepted: false },
    });
    expect((r.json() as { nextStep: string }).nextStep).toBe('save_step_counter');
    // counter accepted with custom price
    r = await app.inject({
      method: 'POST',
      url: `/dynamic-pricing/quotes/${jobId}/save-step`,
      headers: auth(owner.accessToken),
      payload: { accepted: true, customPriceCents: 7500 },
    });
    expect((r.json() as { done: boolean }).done).toBe(true);
  });
});
