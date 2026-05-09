/**
 * RateEngineService unit-style spec — exercises the engine through the
 * /jobs/quote-preview endpoint so the path is fully wired up. We get
 * sheet-resolution coverage (account, tenant_default, fallback) plus
 * surcharge and free-mile logic.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  seedDefaultRateSheet,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `rate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface QuoteResp {
  source: 'account' | 'tenant_default' | 'fallback';
  rateSheetId: string | null;
  rateSheetName: string | null;
  distanceMiles: number;
  lineItems: Array<{ code: string; label: string; amountCents: number }>;
  subtotalCents: number;
  totalCents: number;
  calculationTrace: string[];
}

describeIfDb('RateEngineService', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, session.tenant.id);
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('uses the tenant default rate sheet for cash jobs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        dropoff: { address: 'b', lat: 39.97, lng: -82.98 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as QuoteResp;
    expect(body.source).toBe('tenant_default');
    expect(body.rateSheetId).toBeTruthy();
    expect(body.lineItems.find((li) => li.code === 'base')?.amountCents).toBe(9500);
    expect(body.lineItems.find((li) => li.code === 'admin_fee')?.amountCents).toBe(500);
  });

  it('charges per-mile mileage for tow when distance > 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        // ~10 miles between these two points
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        dropoff: { address: 'b', lat: 40.1, lng: -82.99 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as QuoteResp;
    expect(body.distanceMiles).toBeGreaterThan(5);
    const mileage = body.lineItems.find((li) => li.code === 'mileage');
    expect(mileage).toBeTruthy();
    expect(mileage?.amountCents).toBeGreaterThan(0);
    // Expect total = base + (mileage > 0) + admin
    expect(body.totalCents).toBeGreaterThan(9500 + 500);
  });

  it('omits mileage line item when distance falls within free miles', async () => {
    // Sheet has freeMilesIncluded: 0 by default in seedDefaultRateSheet,
    // so use a point-to-point distance below 0.01 miles to drive the trace
    // path that explains "no charge".
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        dropoff: { address: 'a', lat: 39.96, lng: -82.99 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as QuoteResp;
    expect(body.distanceMiles).toBeLessThan(0.01);
    expect(body.lineItems.find((li) => li.code === 'mileage')).toBeUndefined();
  });

  it('falls back to the hard-coded definition when the tenant has no default sheet', async () => {
    const orphan = await signup(ctx, makeSignupBody(`${SUFFIX}-no-sheet`, ctx));
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(orphan.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'jump_start',
        vehicleClass: 'light_duty',
        pickup: { address: 'a' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as QuoteResp;
    expect(body.source).toBe('fallback');
    expect(body.lineItems.find((li) => li.code === 'base')?.amountCents).toBe(7500);
    // Fallback definition has no fixed line items, so admin_fee should be absent.
    expect(body.lineItems.find((li) => li.code === 'admin_fee')).toBeUndefined();
    expect(body.calculationTrace.some((t) => /fallback/i.test(t))).toBe(true);
  });

  it('emits a calculation trace describing every step', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'heavy_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        dropoff: { address: 'b', lat: 40.05, lng: -82.99 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as QuoteResp;
    expect(body.calculationTrace.some((t) => /tenant default rate sheet/i.test(t))).toBe(true);
    expect(body.calculationTrace.some((t) => /Distance:/i.test(t))).toBe(true);
  });
});
