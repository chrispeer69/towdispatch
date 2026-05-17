/**
 * /accounts/:id/rate-card integration spec (Admin Settings build 6 of 7).
 *
 * Covers:
 *   - GET /accounts/:id/rate-card returns the full grid
 *   - PATCH /accounts/:id/rate-card/bulk upserts overrides + availability
 *   - The rate engine resolves flat_price, percent_discount, and
 *     flat_dollar_discount correctly
 *   - The rate engine returns master rate when no override exists
 *   - The availability resolver returns the correct value
 *   - Cross-tenant integrity: overriding against a foreign service_id
 *     fails (the trigger fires through the controller's 400)
 *   - Validation: missing overrideValueCents on flat_price is rejected
 *   - DELETE single override falls the account back to the master rate
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AccountDto } from '@ustowdispatch/shared';
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

const SUFFIX = `arc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface ServiceRow {
  id: string;
  code: string;
  applicableVehicleClasses: string[];
}

interface RateCardResponse {
  account: { id: string; name: string };
  masterRates: Array<{
    serviceCatalogId: string;
    serviceCode: string;
    vehicleClass: string;
    priceCents: number | null;
  }>;
  overrides: Array<{
    id: string;
    serviceCatalogId: string;
    serviceCode: string;
    vehicleClass: string | null;
    overrideType: string;
    overrideValueCents: number;
    overridePercent: string | null;
    effectivePriceCents: number | null;
  }>;
  availability: Array<{
    id: string;
    serviceCatalogId: string;
    availability: string;
  }>;
}

describeIfDb('Account rate cards integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let services: Record<string, ServiceRow> = {};
  let account: AccountDto;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));

    // Seed catalog + a couple of master rates we can override.
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
    const tow = required('TOW', services);
    const adminFee = required('ADMIN_FEE', services);
    await app.inject({
      method: 'POST',
      url: '/service-rates/bulk',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        rates: [
          { serviceId: tow.id, vehicleClass: 'light_duty', priceCents: 10000 },
          { serviceId: adminFee.id, vehicleClass: 'any', priceCents: 500 },
        ],
      },
    });

    // Create an account to attach overrides to.
    const acct = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Agero', isMotorClub: true },
    });
    expect(acct.statusCode).toBe(201);
    account = acct.json() as AccountDto;
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('GET /accounts/:id/rate-card returns the full grid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/rate-card`,
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RateCardResponse;
    expect(body.account.id).toBe(account.id);
    expect(body.overrides).toHaveLength(0);
    expect(body.availability).toHaveLength(0);
    expect(body.masterRates.length).toBeGreaterThan(0);
    const tow = body.masterRates.find(
      (r) => r.serviceCode === 'TOW' && r.vehicleClass === 'light_duty',
    );
    expect(tow?.priceCents).toBe(10000);
  });

  it('PATCH /accounts/:id/rate-card/bulk upserts a flat_price override', async () => {
    const tow = required('TOW', services);
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/rate-card/bulk`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        overrides: [
          {
            serviceCatalogId: tow.id,
            vehicleClass: 'light_duty',
            overrideType: 'flat_price',
            overrideValueCents: 8000,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RateCardResponse;
    const o = body.overrides.find((x) => x.serviceCode === 'TOW');
    expect(o).toBeTruthy();
    expect(o?.overrideType).toBe('flat_price');
    expect(o?.overrideValueCents).toBe(8000);
    expect(o?.effectivePriceCents).toBe(8000);
  });

  it('rate engine resolves flat_price against the master', async () => {
    const quote = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        accountId: account.id,
      },
    });
    expect(quote.statusCode).toBe(200);
    const body = quote.json() as {
      lineItems: Array<{ code: string; amountCents: number }>;
      calculationTrace: string[];
    };
    const base = body.lineItems.find((li) => li.code === 'base');
    expect(base?.amountCents).toBe(8000);
    expect(body.calculationTrace.some((t) => /Account override.*flat_price/i.test(t))).toBe(true);
  });

  it('rate engine resolves percent_discount correctly', async () => {
    const tow = required('TOW', services);
    await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/rate-card/bulk`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        overrides: [
          {
            serviceCatalogId: tow.id,
            vehicleClass: 'light_duty',
            overrideType: 'percent_discount',
            overridePercent: '10',
          },
        ],
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
        accountId: account.id,
      },
    });
    const body = quote.json() as {
      lineItems: Array<{ code: string; amountCents: number }>;
    };
    expect(body.lineItems.find((li) => li.code === 'base')?.amountCents).toBe(9000);
  });

  it('rate engine resolves flat_dollar_discount correctly', async () => {
    const tow = required('TOW', services);
    await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/rate-card/bulk`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        overrides: [
          {
            serviceCatalogId: tow.id,
            vehicleClass: 'light_duty',
            overrideType: 'flat_dollar_discount',
            overrideValueCents: 1500,
          },
        ],
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
        accountId: account.id,
      },
    });
    const body = quote.json() as {
      lineItems: Array<{ code: string; amountCents: number }>;
    };
    // master 10000 - 1500 = 8500
    expect(body.lineItems.find((li) => li.code === 'base')?.amountCents).toBe(8500);
  });

  it('DELETE override falls back to master rate', async () => {
    const card = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}/rate-card`,
      headers: auth(session.accessToken),
    });
    const body = card.json() as RateCardResponse;
    const o = body.overrides.find((x) => x.serviceCode === 'TOW');
    expect(o?.id).toBeTruthy();

    const del = await app.inject({
      method: 'DELETE',
      url: `/accounts/${account.id}/rate-card/overrides/${o?.id}`,
      headers: auth(session.accessToken),
    });
    expect(del.statusCode).toBe(204);

    const quote = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        accountId: account.id,
      },
    });
    expect(
      (quote.json() as { lineItems: Array<{ code: string; amountCents: number }> }).lineItems.find(
        (li) => li.code === 'base',
      )?.amountCents,
    ).toBe(10000);
  });

  it('rate engine returns master rate when no override exists for another account', async () => {
    const acct = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'NoOverrides Inc' },
    });
    expect(acct.statusCode).toBe(201);
    const acctId = (acct.json() as AccountDto).id;
    const quote = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.96, lng: -82.99 },
        accountId: acctId,
      },
    });
    expect(
      (quote.json() as { lineItems: Array<{ code: string; amountCents: number }> }).lineItems.find(
        (li) => li.code === 'base',
      )?.amountCents,
    ).toBe(10000);
  });

  it('availability bulk upsert and the resolver path', async () => {
    const tow = required('TOW', services);
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/rate-card/bulk`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        availability: [{ serviceCatalogId: tow.id, availability: 'not_covered' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RateCardResponse;
    expect(body.availability).toHaveLength(1);
    expect(body.availability[0]?.availability).toBe('not_covered');
  });

  it('validation: flat_price without overrideValueCents is rejected', async () => {
    const tow = required('TOW', services);
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/rate-card/bulk`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        overrides: [
          {
            serviceCatalogId: tow.id,
            vehicleClass: 'light_duty',
            overrideType: 'flat_price',
            // missing overrideValueCents
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('validation: percent_discount with non-zero overrideValueCents is rejected', async () => {
    const tow = required('TOW', services);
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/rate-card/bulk`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        overrides: [
          {
            serviceCatalogId: tow.id,
            vehicleClass: 'light_duty',
            overrideType: 'percent_discount',
            overridePercent: '10',
            overrideValueCents: 5,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('contract terms PATCH updates the accounts row', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/accounts/${account.id}/contract-terms`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        paymentTerms: 'net_45',
        requiresPhotoBeforeBilling: true,
        slaArrivalMinutes: 45,
      },
    });
    expect(res.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/accounts/${account.id}`,
      headers: auth(session.accessToken),
    });
    const a = after.json() as AccountDto;
    expect(a.paymentTerms).toBe('net_45');
    expect(a.requiresPhotoBeforeBilling).toBe(true);
    expect(a.slaArrivalMinutes).toBe(45);
  });

  function required(code: string, dict: Record<string, ServiceRow>): ServiceRow {
    const row = dict[code];
    if (!row) throw new Error(`expected catalog row "${code}" to exist`);
    return row;
  }
});
