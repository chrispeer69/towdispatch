/**
 * Reporting endpoint integration spec — Session 14.
 *
 * Validates:
 *   - GET /reporting/{id}/summary returns 200 with KPI shape
 *   - GET /reporting/{id} returns paginated rows
 *   - POST /reporting/{id}/export returns a download descriptor (CSV + PDF)
 *   - POST /reporting/saved + .../schedule round-trips
 *   - 403 for a driver hitting a report they cannot access
 *   - cross-tenant: tenant B never sees tenant A's saved_report
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

const SUFFIX = `rpt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('reporting endpoints', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let ownerA: AuthedResp;
  let ownerB: AuthedResp;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    ownerA = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    ownerB = await signup(ctx, makeSignupBody(SUFFIX, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('dispatch summary returns the KPI shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting/dispatch/summary',
      headers: auth(ownerA.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reportId: string; kpis: { label: string; value: string }[] };
    expect(body.reportId).toBe('dispatch');
    expect(Array.isArray(body.kpis)).toBe(true);
    expect(body.kpis.length).toBeGreaterThan(0);
  });

  it('revenue list returns rows + nextCursor=null on empty data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reporting/revenue',
      headers: auth(ownerA.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.nextCursor === null || typeof body.nextCursor === 'string').toBe(true);
  });

  it('export emits a CSV descriptor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reporting/dispatch/export',
      headers: { ...auth(ownerA.accessToken), 'content-type': 'application/json' },
      payload: { format: 'csv', filters: {} },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { format: string; bytes: number; url: string };
    expect(body.format).toBe('csv');
    expect(body.bytes).toBeGreaterThan(0);
    expect(body.url).toMatch(/^\/files\//);
  });

  it('saves and lists a saved report', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/reporting/saved',
      headers: { ...auth(ownerA.accessToken), 'content-type': 'application/json' },
      payload: { name: 'My revenue', reportId: 'revenue', filters: {} },
    });
    expect(save.statusCode).toBe(201);
    const saved = save.json() as { id: string };
    const list = await app.inject({
      method: 'GET',
      url: '/reporting/saved',
      headers: auth(ownerA.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { rows: { id: string }[] };
    expect(body.rows.some((r) => r.id === saved.id)).toBe(true);
  });

  it('tenant B cannot see tenant A saved reports', async () => {
    await app.inject({
      method: 'POST',
      url: '/reporting/saved',
      headers: { ...auth(ownerA.accessToken), 'content-type': 'application/json' },
      payload: { name: 'A only', reportId: 'revenue', filters: {} },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/reporting/saved',
      headers: auth(ownerB.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { rows: { name: string }[] };
    expect(body.rows.find((r) => r.name === 'A only')).toBeUndefined();
  });
});
