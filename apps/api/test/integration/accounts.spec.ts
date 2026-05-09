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

const SUFFIX = `acc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Accounts integration', () => {
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

  it('creates a motor club account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        name: 'Spec Agero',
        billingTerms: 'net_30',
        isMotorClub: true,
        motorClubNetworkCode: 'AGERO',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      isMotorClub: boolean;
      motorClubNetworkCode: string | null;
    };
    expect(body.isMotorClub).toBe(true);
    expect(body.motorClubNetworkCode).toBe('AGERO');
  });

  it('creates a commercial account with credit limit and reports it back', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        name: 'Spec Acme Logistics',
        billingTerms: 'net_45',
        creditLimit: '50000.00',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      creditLimit: string;
      creditUsed: string;
      billingTerms: string;
    };
    expect(body.creditLimit).toBe('50000.00');
    // Postgres returns numeric(12,2) as a string with both decimal places.
    expect(body.creditUsed).toBe('0.00');
    expect(body.billingTerms).toBe('net_45');
  });

  it('lists with isMotorClub filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/accounts?isMotorClub=true',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ isMotorClub: boolean }> };
    for (const a of body.data) expect(a.isMotorClub).toBe(true);
  });

  it('tracks COI fields on update', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { name: 'Spec COI Co', billingTerms: 'net_30' },
      })
    ).json() as { id: string };
    const upd = await app.inject({
      method: 'PATCH',
      url: `/accounts/${created.id}`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        coiRequired: true,
        coiExpiresAt: '2027-01-01',
        coiDocumentUrl: 'https://example.test/coi.pdf',
      },
    });
    expect(upd.statusCode).toBe(200);
    const body = upd.json() as {
      coiRequired: boolean;
      coiExpiresAt: string;
      coiDocumentUrl: string;
    };
    expect(body.coiRequired).toBe(true);
    expect(body.coiExpiresAt).toBe('2027-01-01');
    expect(body.coiDocumentUrl).toBe('https://example.test/coi.pdf');
  });

  it('soft-delete refuses if a customer references the account', async () => {
    const acc = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { name: 'Spec Anchor Account', billingTerms: 'net_30' },
      })
    ).json() as { id: string };
    await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        type: 'account',
        name: 'Anchor Customer',
        phone: '+15555558888',
        accountId: acc.id,
      },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/accounts/${acc.id}`,
      headers: auth(session.accessToken),
    });
    expect(del.statusCode).toBe(409);
  });

  it('cross-tenant account read is blocked by RLS', async () => {
    const otherSession = await signup(ctx, makeSignupBody(`${SUFFIX}-attacker`, ctx));
    const target = (
      await app.inject({
        method: 'POST',
        url: '/accounts',
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { name: 'Spec Tenant A Confidential', billingTerms: 'net_30' },
      })
    ).json() as { id: string };
    const peek = await app.inject({
      method: 'GET',
      url: `/accounts/${target.id}`,
      headers: auth(otherSession.accessToken),
    });
    expect(peek.statusCode).toBe(404);
  });
});
