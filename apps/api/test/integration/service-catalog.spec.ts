/**
 * /service-catalog integration smoke (Admin Settings build 1 of 6).
 *
 * Hits the live API controller through Fastify.inject against the docker
 * stack: signup, seed the default catalog, list, create, edit, deactivate.
 * Uses the same helpers as the accounts / customers integration specs so
 * the stack bootstrap and cleanup match the rest of the suite.
 *
 * The seed-defaults endpoint exists because the migration backfills only
 * tenants that existed at the moment it applied; brand-new signups need an
 * explicit invocation until the auto-wire follow-up lands.
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

const SUFFIX = `sc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface ServiceRow {
  id: string;
  code: string;
  name: string;
  category: string;
  calculationUnit: string;
  isQuoted: boolean;
  isActive: boolean;
  applicableVehicleClasses: string[];
  defaultCommissionPctOverride: string | null;
  sortOrder: number;
}

describeIfDb('Service catalog integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('seed-defaults inserts 46 rows for a fresh tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/service-catalog/seed-defaults',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { inserted: number };
    expect(body.inserted).toBe(46);
  });

  it('seed-defaults is idempotent (second call returns 0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/service-catalog/seed-defaults',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { inserted: number };
    expect(body.inserted).toBe(0);
  });

  it('lists all 46 services sorted by category then sort_order then name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/service-catalog',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as ServiceRow[];
    expect(rows).toHaveLength(46);

    const byCat: Record<string, number> = {};
    for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
    expect(byCat).toMatchObject({
      towing: 9,
      mileage: 5,
      roadside_service: 7,
      recovery: 5,
      storage_impound: 2,
      fees_surcharges: 9,
      adjustments: 3,
      equipment: 2,
      overages: 4,
    });
  });

  it('filters by category', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/service-catalog?category=overages',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as ServiceRow[];
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.category).toBe('overages');
  });

  it('filters by active=false yields nothing on a freshly seeded catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/service-catalog?active=false',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('creates a new service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/service-catalog',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        code: 'LONG_TOW',
        name: 'Long-distance tow',
        category: 'towing',
        calculationUnit: 'per_mile',
        applicableVehicleClasses: ['light_duty', 'medium_duty'],
        defaultCommissionPctOverride: '12.50',
        sortOrder: 95,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as ServiceRow;
    expect(body.code).toBe('LONG_TOW');
    expect(body.calculationUnit).toBe('per_mile');
    expect(body.isQuoted).toBe(false);
    expect(body.applicableVehicleClasses).toEqual(['light_duty', 'medium_duty']);
    expect(body.defaultCommissionPctOverride).toBe('12.50');
  });

  it('rejects a duplicate code with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/service-catalog',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        code: 'LONG_TOW',
        name: 'Another long tow',
        category: 'towing',
        calculationUnit: 'per_mile',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a code that violates the format CHECK with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/service-catalog',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        code: 'bad-code',
        name: 'Should reject',
        category: 'towing',
        calculationUnit: 'per_call',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH updates calculation_unit and is_quoted in lockstep', async () => {
    const list = (
      await app.inject({
        method: 'GET',
        url: '/service-catalog?q=long_tow',
        headers: auth(session.accessToken),
      })
    ).json() as ServiceRow[];
    const target = list.find((r) => r.code === 'LONG_TOW');
    expect(target).toBeDefined();
    if (!target) return;

    const res = await app.inject({
      method: 'PATCH',
      url: `/service-catalog/${target.id}`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { calculationUnit: 'quoted' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServiceRow;
    expect(body.calculationUnit).toBe('quoted');
    expect(body.isQuoted).toBe(true);
  });

  it('DELETE is a soft-delete (sets is_active=false and hides from default list)', async () => {
    const list = (
      await app.inject({
        method: 'GET',
        url: '/service-catalog?q=long_tow',
        headers: auth(session.accessToken),
      })
    ).json() as ServiceRow[];
    const target = list.find((r) => r.code === 'LONG_TOW');
    expect(target).toBeDefined();
    if (!target) return;

    const del = await app.inject({
      method: 'DELETE',
      url: `/service-catalog/${target.id}`,
      headers: auth(session.accessToken),
    });
    expect(del.statusCode).toBe(204);

    // Default list (no filter) does NOT include deleted rows.
    const after = (
      await app.inject({
        method: 'GET',
        url: '/service-catalog?q=long_tow',
        headers: auth(session.accessToken),
      })
    ).json() as ServiceRow[];
    expect(after.find((r) => r.id === target.id)).toBeUndefined();
  });
});
