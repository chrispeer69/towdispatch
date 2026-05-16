/**
 * /service-rates integration smoke (Admin Settings build 2 of 6).
 *
 * Boots the same Fastify stack as the other integration specs, seeds the
 * default catalog for a fresh tenant, then drives the controller through
 * its three jobs:
 *   - GET  /service-rates                 → empty initially
 *   - POST /service-rates/bulk            → upsert + return rows
 *   - GET  /service-rates                 → reflects the upsert
 *
 * Plus a couple of validation guards: the controller must 400 on a
 * class-mismatched upsert (vehicle class that the catalog row doesn't
 * declare as applicable).
 *
 * Also covers the rate engine fallback wiring: with a Master Rate Sheet
 * row for TOW + light_duty, a quote for serviceType=tow / class=light_duty
 * should pick up the new base price instead of the tenant's legacy JSON.
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

const SUFFIX = `sr-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface ServiceRow {
  id: string;
  code: string;
  applicableVehicleClasses: string[];
}

interface RateRow {
  id: string;
  serviceId: string;
  vehicleClass: string;
  priceCents: number;
}

describeIfDb('Service rates integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let services: Record<string, ServiceRow> = {};

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    // Seed defaults so we have catalog rows to price.
    await app.inject({
      method: 'POST',
      url: '/service-catalog/seed-defaults',
      headers: auth(session.accessToken),
    });
    const list = await app.inject({
      method: 'GET',
      url: '/service-catalog',
      headers: auth(session.accessToken),
    });
    const rows = list.json() as ServiceRow[];
    services = Object.fromEntries(rows.map((r) => [r.code, r]));
    // Also seed the legacy tenant_default rate sheet so the rate engine
    // fallback test has a baseline to compare against.
    await seedDefaultRateSheet(ctx, session.tenant.id);
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('GET /service-rates returns empty for a brand-new tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/service-rates',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /service-rates/bulk upserts class-specific + class-independent rows', async () => {
    const tow = required('TOW', services);
    const adminFee = required('ADMIN_FEE', services);

    const res = await app.inject({
      method: 'POST',
      url: '/service-rates/bulk',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        rates: [
          { serviceId: tow.id, vehicleClass: 'light_duty', priceCents: 9500 },
          { serviceId: adminFee.id, vehicleClass: 'any', priceCents: 500 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { saved: number; rates: RateRow[] };
    expect(body.saved).toBe(2);
    expect(body.rates.find((r) => r.serviceId === tow.id)?.priceCents).toBe(9500);
    expect(body.rates.find((r) => r.serviceId === adminFee.id)?.priceCents).toBe(500);
  });

  it('GET /service-rates reflects the upsert', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/service-rates',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as RateRow[];
    expect(rows).toHaveLength(2);
    const towCatalog = required('TOW', services);
    const tow = rows.find((r) => r.serviceId === towCatalog.id);
    expect(tow?.priceCents).toBe(9500);
    expect(tow?.vehicleClass).toBe('light_duty');
  });

  it('bulk upsert with a non-applicable vehicle class is rejected with 400', async () => {
    const heavy = required('HEAVY_DUTY_TOW', services); // applicable: heavy_duty only
    const res = await app.inject({
      method: 'POST',
      url: '/service-rates/bulk',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        rates: [{ serviceId: heavy.id, vehicleClass: 'light_duty', priceCents: 5 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bulk upsert that sends "any" to a class-dependent service is rejected', async () => {
    const tow = required('TOW', services); // applicable: light_duty
    const res = await app.inject({
      method: 'POST',
      url: '/service-rates/bulk',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        rates: [{ serviceId: tow.id, vehicleClass: 'any', priceCents: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate engine reads from service_rates before falling back to legacy JSON', async () => {
    // The Master Rate Sheet TOW / light_duty is set to 9500¢. The legacy
    // seedDefaultRateSheet ALSO maps tow/light_duty to 9500¢, so to prove
    // the engine actually consulted the new path we update the rate to a
    // distinctive value and quote again.
    const tow = required('TOW', services);
    await app.inject({
      method: 'POST',
      url: '/service-rates/bulk',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        rates: [{ serviceId: tow.id, vehicleClass: 'light_duty', priceCents: 12345 }],
      },
    });

    const quote = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
      },
    });
    expect(quote.statusCode).toBe(200);
    const body = quote.json() as {
      lineItems: Array<{ code: string; amountCents: number }>;
      calculationTrace: string[];
    };
    const base = body.lineItems.find((li) => li.code === 'base');
    expect(base?.amountCents).toBe(12345);
    expect(body.calculationTrace.some((t) => /Master Rate Sheet base/i.test(t))).toBe(true);
  });

  // Helper hoisted inside the suite for closure access to `services`. Throws
  // a helpful message instead of returning undefined so TS narrows the
  // result and the test stack trace lands at the call site.
  function required(code: string, dict: Record<string, ServiceRow>): ServiceRow {
    const row = dict[code];
    if (!row) throw new Error(`expected catalog row "${code}" to exist`);
    return row;
  }

  it('rate engine falls back to legacy JSON when no service_rates row matches', async () => {
    // jump_start is mapped to JUMP_START_SERVICE in the engine's
    // SERVICE_TYPE_CATALOG_CODE table. We haven't set a price for it, so
    // the engine must consult the legacy rate_sheets JSON instead. The
    // seedDefaultRateSheet helper sets jump_start to 7500¢.
    const quote = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'jump_start',
        vehicleClass: 'light_duty',
        pickup: { address: 'a' },
      },
    });
    expect(quote.statusCode).toBe(200);
    const body = quote.json() as {
      lineItems: Array<{ code: string; amountCents: number }>;
      calculationTrace: string[];
    };
    expect(body.lineItems.find((li) => li.code === 'base')?.amountCents).toBe(7500);
    expect(body.calculationTrace.some((t) => /Master Rate Sheet base/i.test(t))).toBe(false);
  });
});
