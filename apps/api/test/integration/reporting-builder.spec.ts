/**
 * Integration + cross-tenant coverage for the Session 53 reporting surfaces:
 * custom builder, KPI dashboard, P&L, and aging. DB-gated (skips when no
 * DATABASE_URL/REDIS_URL), mirroring the rest of the integration suite.
 *
 * Asserts: build → save → run returns allowlisted columns; the field allowlist
 * rejects unknown fields (400); and Tenant B can never read or run Tenant A's
 * template (404) — RLS + ownership isolation on report_templates.
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

const describeIfDb = skipIfNoDb ? describe.skip : describe;
const rand = () => Math.floor(Math.random() * 1e6).toString(36);

describeIfDb('Reporting builder + KPI + aging (Session 53)', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let a: AuthedResp;
  let b: AuthedResp;
  let templateId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    a = await signup(ctx, makeSignupBody(`rptA-${rand()}`, ctx));
    b = await signup(ctx, makeSignupBody(`rptB-${rand()}`, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('creates a jobs template (tenant A)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reporting/builder/templates',
      headers: { ...auth(a.accessToken), 'content-type': 'application/json' },
      payload: {
        name: `Completed jobs ${rand()}`,
        baseEntity: 'jobs',
        selectedFields: ['job_number', 'status', 'rate_quoted_cents'],
        filters: [{ field: 'status', op: 'eq', value: 'completed' }],
        groupBy: [],
        sort: [{ field: 'job_number', dir: 'asc' }],
        isSharedWithTenant: false,
      },
    });
    expect(res.statusCode).toBe(201);
    templateId = res.json().id as string;
    expect(templateId).toMatch(/[0-9a-f-]{36}/);
  });

  it('runs the saved template and returns allowlisted columns', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/reporting/builder/templates/${templateId}/run`,
      headers: { ...auth(a.accessToken), 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns.map((c: { key: string }) => c.key)).toEqual([
      'job_number',
      'status',
      'rate_quoted_cents',
    ]);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.truncated).toBe(false);
  });

  it('rejects an unknown field at preview (allowlist → 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reporting/builder/preview',
      headers: { ...auth(a.accessToken), 'content-type': 'application/json' },
      payload: { baseEntity: 'jobs', selectedFields: ['password_hash'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("Tenant B cannot read Tenant A's template (404)", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/reporting/builder/templates/${templateId}`,
      headers: auth(b.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B cannot run Tenant A's template (404)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/reporting/builder/templates/${templateId}/run`,
      headers: { ...auth(b.accessToken), 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('serves the KPI catalog and computes a widget', async () => {
    const cat = await app.inject({
      method: 'GET',
      url: '/reporting/kpi/widgets',
      headers: auth(a.accessToken),
    });
    expect(cat.statusCode).toBe(200);
    expect(cat.json().data.length).toBe(12);

    const w = await app.inject({
      method: 'GET',
      url: '/reporting/kpi/widgets/jobs_today',
      headers: auth(a.accessToken),
    });
    expect(w.statusCode).toBe(200);
    expect(typeof w.json().value).toBe('number');
  });

  it('returns a default KPI layout then persists a saved one', async () => {
    const def = await app.inject({
      method: 'GET',
      url: '/reporting/kpi/layouts/me',
      headers: auth(a.accessToken),
    });
    expect(def.statusCode).toBe(200);
    expect(def.json().isDefault).toBe(true);

    const saved = await app.inject({
      method: 'PUT',
      url: '/reporting/kpi/layouts/me',
      headers: { ...auth(a.accessToken), 'content-type': 'application/json' },
      payload: {
        layout: [{ widgetId: 'jobs_today', x: 0, y: 0, w: 4, h: 1, config: {} }],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().isDefault).toBe(false);
    expect(saved.json().layout).toHaveLength(1);
  });

  it('serves the aging report bound to the tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting/aging?bucket_days=30,60,90',
      headers: auth(a.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bucketDays).toEqual([30, 60, 90]);
    expect(Array.isArray(res.json().rows)).toBe(true);
  });

  it('serves per-account P&L', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting/pnl/accounts?from=2026-05-01T00:00:00Z&to=2026-05-31T23:59:59Z',
      headers: auth(a.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dimension).toBe('accounts');
  });
});
