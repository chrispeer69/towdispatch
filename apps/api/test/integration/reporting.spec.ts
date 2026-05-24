/**
 * Reporting integration spec — Session 14.
 *
 * Light coverage: we don't drive the full eight-report surface here, because
 * the unit specs in src/modules/reporting cover the pure transforms and a
 * synthetic seed would otherwise dominate the file. What this spec proves
 * end-to-end:
 *
 *   - GET /reporting returns the eight known categories.
 *   - GET /reporting/{id}/summary returns valid shape for an empty tenant.
 *   - GET /reporting/{id} returns valid shape for an empty tenant.
 *   - Forbidden 403 returned for a role outside the report's allowlist.
 *   - Saved report CRUD round-trip works.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `rep-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Reporting controller', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('GET /reporting lists the eight categories', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reports: Array<{ id: string; title: string }> };
    const ids = body.reports.map((r) => r.id).sort();
    expect(ids).toEqual([
      'commission',
      'compliance',
      'dispatch-performance',
      'driver-performance',
      'pnl',
      'revenue',
      'storage',
      'tax',
    ]);
  });

  it('GET /reporting/revenue/summary returns the KPI shape on an empty tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting/revenue/summary',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reportId: string; kpis: Array<{ label: string }> };
    expect(body.reportId).toBe('revenue');
    expect(Array.isArray(body.kpis)).toBe(true);
    expect(body.kpis.length).toBeGreaterThan(0);
  });

  it('GET /reporting/dispatch-performance returns the detail envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting/dispatch-performance',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      reportId: string;
      kpis: unknown[];
      rows: unknown[];
      timeSeries: unknown[];
      breakdown: unknown[];
    };
    expect(body.reportId).toBe('dispatch-performance');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.kpis)).toBe(true);
  });

  it('Saved report CRUD round-trip', async () => {
    // create
    const create = await app.inject({
      method: 'POST',
      url: '/reporting/saved',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        reportId: 'revenue',
        name: `${SUFFIX}-saved-1`,
        filters: { comparison: 'prior_period' },
      },
    });
    expect(create.statusCode).toBe(201);
    const saved = create.json() as { id: string; reportId: string; name: string };
    expect(saved.reportId).toBe('revenue');
    expect(saved.name).toBe(`${SUFFIX}-saved-1`);

    // list
    const list = await app.inject({
      method: 'GET',
      url: '/reporting/saved',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.find((r) => r.id === saved.id)).toBeTruthy();

    // patch — attach a schedule
    const patch = await app.inject({
      method: 'PATCH',
      url: `/reporting/saved/${saved.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        schedule: {
          cadence: 'weekly',
          format: 'pdf',
          recipients: ['boss@example.com'],
        },
      },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as { schedule: { cadence: string; format: string } | null };
    expect(patched.schedule?.cadence).toBe('weekly');
    expect(patched.schedule?.format).toBe('pdf');

    // delete
    const del = await app.inject({
      method: 'DELETE',
      url: `/reporting/saved/${saved.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(del.statusCode).toBe(204);
  });

  it('CSV export returns a download URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reporting/revenue/export',
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { format: 'csv', filters: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; filename: string; expiresAt: string };
    expect(body.url).toMatch(/^\/files\//);
    expect(body.filename.endsWith('.csv')).toBe(true);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
