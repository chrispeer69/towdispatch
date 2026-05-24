/**
 * Integration test for PATCH /tenants/current — Company Profile (build 7 of 7).
 *
 *   - First save: full required payload accepted, persisted under settings.
 *   - First save with a required field missing → 400.
 *   - Partial patch merges into existing settings without dropping keys.
 *   - Name patch is independent from settings.
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

const SUFFIX = `tcp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

const FULL_SETTINGS = {
  dba_name: 'Acme DBA',
  federal_ein: '12-3456789',
  state_license_number: 'TX-12345',
  mc_dot_number: 'MC-99999',
  physical_address: {
    street_1: '100 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
  },
  phone: '+15551234567',
  email: 'company@example.com',
  website: 'https://example.com',
  brand_color: '#1E40AF',
  business_hours: {
    monday: { closed: false, open: '08:00', close: '17:00' },
    tuesday: { closed: false, open: '08:00', close: '17:00' },
    wednesday: { closed: false, open: '08:00', close: '17:00' },
    thursday: { closed: false, open: '08:00', close: '17:00' },
    friday: { closed: false, open: '08:00', close: '17:00' },
    saturday: { closed: true },
    sunday: { closed: true },
  },
  timezone: 'America/Chicago',
  owner_name: 'Owner Tester',
  owner_mobile: '+15559876543',
  default_lien_state: 'TX',
};

describeIfDb('Company Profile (PATCH /tenants/current)', () => {
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

  it('first save with all required fields persists settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tenants/current',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { settings: FULL_SETTINGS },
    });
    expect(res.statusCode).toBe(200);
    const tenant = res.json() as { settings: Record<string, unknown> };
    expect(tenant.settings.federal_ein).toBe(FULL_SETTINGS.federal_ein);
    expect(tenant.settings.timezone).toBe(FULL_SETTINGS.timezone);
  });

  it('partial patch merges into existing settings without dropping keys', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tenants/current',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { settings: { brand_color: '#FF5500' } },
    });
    expect(res.statusCode).toBe(200);
    const tenant = res.json() as { settings: Record<string, unknown> };
    expect(tenant.settings.brand_color).toBe('#FF5500');
    expect(tenant.settings.federal_ein).toBe(FULL_SETTINGS.federal_ein);
    expect(tenant.settings.timezone).toBe(FULL_SETTINGS.timezone);
    expect((tenant.settings.physical_address as { city?: string } | undefined)?.city).toBe(
      FULL_SETTINGS.physical_address.city,
    );
  });

  it('name patch is independent from settings', async () => {
    const newName = 'Renamed Workshop';
    const res = await app.inject({
      method: 'PATCH',
      url: '/tenants/current',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: newName },
    });
    expect(res.statusCode).toBe(200);
    const tenant = res.json() as { name: string; settings: Record<string, unknown> };
    expect(tenant.name).toBe(newName);
    expect(tenant.settings.federal_ein).toBe(FULL_SETTINGS.federal_ein);
  });

  it('first save with required field missing → 400', async () => {
    const fresh = await signup(ctx, makeSignupBody(`${SUFFIX}-fresh`, ctx));
    const { timezone: _unused, ...incomplete } = FULL_SETTINGS;
    const res = await app.inject({
      method: 'PATCH',
      url: '/tenants/current',
      headers: { ...auth(fresh.accessToken), 'content-type': 'application/json' },
      payload: { settings: incomplete },
    });
    expect(res.statusCode).toBe(400);
  });
});
