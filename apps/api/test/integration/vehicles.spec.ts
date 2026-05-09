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

const SUFFIX = `veh-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Vehicles integration', () => {
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

  it('creates a vehicle by plate (no VIN)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        plate: 'ABC123',
        plateState: 'OH',
        year: 2020,
        make: 'Honda',
        model: 'Civic',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string };
    expect(body.id).toBeTruthy();
  });

  it('rejects an invalid VIN format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        vin: 'TOO-SHORT',
        year: 2020,
        make: 'Bad',
        model: 'VIN',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('plate lookup returns the matching vehicle', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/vehicles/lookup?plate=ABC123&state=OH',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { make: string; model: string };
    expect(body.make).toBe('Honda');
    expect(body.model).toBe('Civic');
  });

  it('plate lookup returns 404 for unknown plate', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/vehicles/lookup?plate=NOPE&state=CA',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('soft-delete hides vehicle from list', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/vehicles',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { plate: 'ZZZ999', plateState: 'NY', make: 'Old', model: 'Truck' },
      })
    ).json() as { id: string };
    const del = await app.inject({
      method: 'DELETE',
      url: `/vehicles/${created.id}`,
      headers: auth(session.accessToken),
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: 'GET',
      url: `/vehicles/${created.id}`,
      headers: auth(session.accessToken),
    });
    expect(get.statusCode).toBe(404);
  });

  it('cross-tenant vehicle read is blocked by RLS', async () => {
    const otherSession = await signup(ctx, makeSignupBody(`${SUFFIX}-attacker`, ctx));
    const target = (
      await app.inject({
        method: 'POST',
        url: '/vehicles',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { plate: 'CRSTNT', plateState: 'TX', make: 'Tenant A', model: 'Car' },
      })
    ).json() as { id: string };

    const peek = await app.inject({
      method: 'GET',
      url: `/vehicles/${target.id}`,
      headers: auth(otherSession.accessToken),
    });
    expect(peek.statusCode).toBe(404);
  });
});
