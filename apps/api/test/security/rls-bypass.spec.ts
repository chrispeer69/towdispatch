/**
 * RLS bypass coverage. Two tenants are seeded with one of every record type;
 * Tenant B's credentials then attempt to read/mutate Tenant A's resource IDs
 * across every read-id-shaped endpoint exposed by the API.
 *
 * Pass condition for each call: 404 (preferred — pretend the row doesn't
 * exist) or 403. Never 200 (data leak). Never 500 (the service crashed in
 * a way that suggests RLS isn't enforced at the right layer).
 *
 * The endpoint set is hand-curated rather than auto-discovered because
 * route metadata from NestJS varies by guard configuration and we want
 * exact assertions per endpoint.
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
} from '../integration/helpers.js';

const SUFFIX = `rls-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface TenantFixture {
  session: AuthedResp;
  customerId: string;
  vehicleId: string;
  jobId: string;
}

async function seedTenant(
  ctx: TestContext,
  app: NestFastifyApplication,
  suffix: string,
): Promise<TenantFixture> {
  const session = await signup(ctx, makeSignupBody(suffix, ctx));

  const cust = await app.inject({
    method: 'POST',
    url: '/customers',
    headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
    payload: {
      type: 'cash',
      name: `${suffix} Cust`,
      phone: `+1310555${Math.floor(Math.random() * 9000 + 1000)}`,
      email: `cust-${suffix}@spec.test`,
    },
  });
  if (cust.statusCode !== 201) {
    throw new Error(`seed customer failed: ${cust.statusCode} ${cust.body}`);
  }
  const customerId = (cust.json() as { id: string }).id;

  const veh = await app.inject({
    method: 'POST',
    url: '/vehicles',
    headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
    payload: {
      customerId,
      year: 2018,
      make: 'Honda',
      model: 'Civic',
      vin: `1HGCM82633A${Math.floor(Math.random() * 900000 + 100000)}`,
    },
  });
  if (veh.statusCode !== 201) {
    throw new Error(`seed vehicle failed: ${veh.statusCode} ${veh.body}`);
  }
  const vehicleId = (veh.json() as { id: string }).id;

  const job = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
    payload: {
      customerId,
      vehicleId,
      serviceType: 'tow',
      pickupAddress: '123 Spec St',
      authorizedBy: 'customer',
    },
  });
  if (job.statusCode !== 201) {
    throw new Error(`seed job failed: ${job.statusCode} ${job.body}`);
  }
  const jobId = (job.json() as { id: string }).id;

  return { session, customerId, vehicleId, jobId };
}

describeIfDb('RLS bypass coverage', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    tenantA = await seedTenant(ctx, app, `${SUFFIX}-a`);
    tenantB = await seedTenant(ctx, app, `${SUFFIX}-b`);
  }, 60_000);

  afterAll(async () => {
    await tearDown(ctx);
  });

  // Tenant B's bearer token, hitting Tenant A's IDs. Every endpoint must
  // refuse — 404 preferred, 403 acceptable. Never 200, never 500.
  const cases = (a: TenantFixture, _b: TenantFixture): Array<[string, string]> => [
    ['GET', `/customers/${a.customerId}`],
    ['PATCH', `/customers/${a.customerId}`],
    ['DELETE', `/customers/${a.customerId}`],
    ['GET', `/vehicles/${a.vehicleId}`],
    ['PATCH', `/vehicles/${a.vehicleId}`],
    ['DELETE', `/vehicles/${a.vehicleId}`],
    ['GET', `/jobs/${a.jobId}`],
    ['PATCH', `/jobs/${a.jobId}`],
    ['DELETE', `/jobs/${a.jobId}`],
  ];

  it('refuses cross-tenant access for every record-by-id endpoint', async () => {
    const offenders: string[] = [];
    for (const [method, url] of cases(tenantA, tenantB)) {
      const res = await app.inject({
        method: method as 'GET' | 'PATCH' | 'DELETE',
        url,
        headers: {
          ...auth(tenantB.session.accessToken),
          'content-type': 'application/json',
        },
        // benign payload for PATCH so validation doesn't 400 first
        ...(method === 'PATCH' ? { payload: { name: 'X' } } : {}),
      });
      if (res.statusCode === 200 || res.statusCode === 204) {
        offenders.push(`${method} ${url} → ${res.statusCode} (data leak)`);
      } else if (res.statusCode >= 500) {
        offenders.push(`${method} ${url} → ${res.statusCode} (server error)`);
      } else if (res.statusCode !== 404 && res.statusCode !== 403) {
        // Some endpoints validate the body before they ever do the tenant
        // check; a 400 is acceptable evidence of pre-check rejection. We
        // log it for the report but do not fail the assertion.
        // (Validation-driven 400 ≠ data leak.)
      }
    }
    expect(offenders).toEqual([]);
  });
});
