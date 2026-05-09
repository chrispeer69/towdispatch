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

const SUFFIX = `cust-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Customers integration', () => {
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

  it('creates a customer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        type: 'cash',
        name: 'John Smith',
        phone: '+15555550100',
        email: 'john@spec.test',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; name: string };
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('John Smith');
  });

  it('list returns the created customer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/customers',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ name: string }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.find((c) => c.name === 'John Smith')).toBeTruthy();
  });

  it('filters by type', async () => {
    await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { type: 'cash', name: 'Cash McShellPay', phone: '+15555550101' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/customers?type=cash',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ type: string }> };
    for (const c of body.data) expect(c.type).toBe('cash');
  });

  it('search returns matching customers with vehicleCount', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/customers/search?q=John',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string; vehicleCount: number }>;
    const john = body.find((c) => c.name === 'John Smith');
    expect(john).toBeTruthy();
    expect(john?.vehicleCount).toBe(0);
  });

  it('soft-delete hides the customer from list', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { type: 'cash', name: 'To Be Deleted', phone: '+15555550199' },
      })
    ).json() as { id: string };
    const del = await app.inject({
      method: 'DELETE',
      url: `/customers/${created.id}`,
      headers: auth(session.accessToken),
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: 'GET',
      url: `/customers/${created.id}`,
      headers: auth(session.accessToken),
    });
    expect(get.statusCode).toBe(404);
  });

  it('rejects a phone duplicate within the same tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { type: 'cash', name: 'Dup Phone', phone: '+15555550100' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('cross-tenant access is blocked by RLS (404, not data leak)', async () => {
    const otherSession = await signup(ctx, makeSignupBody(`${SUFFIX}-attacker`, ctx));
    const list = await app.inject({
      method: 'GET',
      url: '/customers',
      headers: auth(otherSession.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: unknown[] };
    expect(body.data).toHaveLength(0);

    // Try to read tenant A's customer by id from tenant B's session.
    const target = (
      await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { type: 'cash', name: 'Tenant A Secret', phone: '+15555559999' },
      })
    ).json() as { id: string };
    const peek = await app.inject({
      method: 'GET',
      url: `/customers/${target.id}`,
      headers: auth(otherSession.accessToken),
    });
    expect(peek.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------- //
  // findOrCreateByContact — used by Session 4 (Call Intake)
  // ---------------------------------------------------------------------- //
  it('findOrCreateByContact: same phone twice returns the same customer (no duplicate)', async () => {
    const phone = '+15555556601';
    const first = await app.inject({
      method: 'POST',
      url: '/customers/find-or-create-by-contact',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Auto Created', phone },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as {
      customer: { id: string; createdVia: string };
      created: boolean;
    };
    expect(firstBody.created).toBe(true);
    expect(firstBody.customer.createdVia).toBe('auto_intake');

    const second = await app.inject({
      method: 'POST',
      url: '/customers/find-or-create-by-contact',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Auto Created (different)', phone },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as {
      customer: { id: string };
      created: boolean;
    };
    expect(secondBody.created).toBe(false);
    expect(secondBody.customer.id).toBe(firstBody.customer.id);
  });

  it('findOrCreateByContact: new phone creates a customer with type=cash', async () => {
    const phone = '+15555556602';
    const res = await app.inject({
      method: 'POST',
      url: '/customers/find-or-create-by-contact',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Brand New', phone, email: 'brand@new.test' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      customer: { type: string; createdVia: string; email: string | null };
      created: boolean;
    };
    expect(body.created).toBe(true);
    expect(body.customer.type).toBe('cash');
    expect(body.customer.createdVia).toBe('auto_intake');
    expect(body.customer.email).toBe('brand@new.test');
  });

  it('findOrCreateByContact: tenant A phone does not collide with tenant B', async () => {
    const phone = '+15555556603';
    // Create in A.
    const a = await app.inject({
      method: 'POST',
      url: '/customers/find-or-create-by-contact',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Tenant A Caller', phone },
    });
    expect(a.statusCode).toBe(201);
    const aBody = a.json() as { customer: { id: string }; created: boolean };
    expect(aBody.created).toBe(true);

    // Same phone, different tenant → must NOT find tenant A's row.
    const otherSession = await signup(
      ctx,
      makeSignupBody(`${SUFFIX}-x-tenant-${Date.now().toString(36)}`, ctx),
    );
    const b = await app.inject({
      method: 'POST',
      url: '/customers/find-or-create-by-contact',
      headers: { ...auth(otherSession.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Tenant B Caller', phone },
    });
    expect(b.statusCode).toBe(201);
    const bBody = b.json() as { customer: { id: string; tenantId: string }; created: boolean };
    expect(bBody.created).toBe(true);
    expect(bBody.customer.id).not.toBe(aBody.customer.id);
    expect(bBody.customer.tenantId).not.toBe(session.tenant.id);
  });
});
