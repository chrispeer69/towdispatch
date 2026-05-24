/**
 * Integration — Photo Damage Analysis (Session 42), stub provider path.
 *
 * Exercises the full wiring against the docker DB: request (inline-first
 * processing → complete) → findings persisted → operator override →
 * pre/post comparison (deterministic stub output) → idempotent re-compare →
 * worker tick. Self-skips when no DB/Redis is configured.
 *
 * Deterministic stub note: with photo keys p1..p8, pre_tow and post_tow
 * each yield 6 findings, and compareFindings classifies them as exactly
 * 5 new / 1 pre-existing / 2 inconclusive (see compare.logic.spec.ts for
 * the unit-level proof of the classification rules).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DamageAnalysisWorker } from '../../src/modules/damage-analysis/damage-analysis.worker.js';
import {
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const describeIfDb = skipIfNoDb ? describe.skip : describe;

const PHOTO_KEYS = [
  'job/ev/p1.jpg',
  'job/ev/p2.jpg',
  'job/ev/p3.jpg',
  'job/ev/p4.jpg',
  'job/ev/p5.jpg',
  'job/ev/p6.jpg',
  'job/ev/p7.jpg',
  'job/ev/p8.jpg',
];

describeIfDb('Photo Damage Analysis — integration (stub)', () => {
  let ctx: TestContext;
  let token: string;
  let tenantId: string;
  let jobId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    const me = await signup(ctx, makeSignupBody('dmg-int', ctx));
    token = me.accessToken;
    tenantId = me.tenant.id;

    jobId = uuidv7();
    const c = await ctx.admin.connect();
    try {
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, $3, 'tow', '100 Test Ave', 'customer')`,
        [jobId, tenantId, `DMG-${Date.now()}`],
      );
    } finally {
      c.release();
    }
  }, 60_000);

  afterAll(async () => {
    // Clean damage rows for this tenant before the shared tearDown wipes jobs.
    if (ctx?.admin) {
      const c = await ctx.admin.connect();
      try {
        await c.query('DELETE FROM damage_comparisons WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM damage_findings WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM damage_analyses WHERE tenant_id = $1', [tenantId]);
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  async function requestAnalysis(
    phase: 'pre_tow' | 'post_tow',
  ): Promise<{ id: string; status: string; findings: unknown[] }> {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/damage-analysis',
      headers: { 'content-type': 'application/json', ...auth(token) },
      payload: {
        jobId,
        phase,
        photoKeys: PHOTO_KEYS,
        vehicleContext: { make: 'Toyota', model: 'Camry', year: 2019, color: 'silver' },
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  let preId: string;
  let postId: string;

  it('requestAnalysis completes inline (stub) and persists 6 findings — pre_tow', async () => {
    const detail = await requestAnalysis('pre_tow');
    preId = detail.id;
    expect(detail.status).toBe('complete');
    expect(detail.findings).toHaveLength(6);
  });

  it('requestAnalysis completes inline — post_tow', async () => {
    const detail = await requestAnalysis('post_tow');
    postId = detail.id;
    expect(detail.status).toBe('complete');
    expect(detail.findings).toHaveLength(6);
  });

  it('lists both analyses for the job', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/damage-analysis?jobId=${jobId}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('operator can override (dismiss) a finding without deleting it', async () => {
    const detail = (await ctx.app
      .inject({ method: 'GET', url: `/damage-analysis/${preId}`, headers: auth(token) })
      .then((r) => r.json())) as { findings: Array<{ id: string }> };
    const findingId = detail.findings[0]?.id;
    expect(findingId).toBeDefined();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/damage-analysis/${preId}/findings/${findingId}`,
      headers: { 'content-type': 'application/json', ...auth(token) },
      payload: { isDismissed: true, operatorNote: 'mirror glare, not damage' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as { isDismissed: boolean; overriddenBy: string | null };
    expect(updated.isDismissed).toBe(true);
    expect(updated.overriddenBy).not.toBeNull();
  });

  it('compares pre vs post into 5 new / 1 pre-existing / 2 inconclusive', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/damage-analysis/compare',
      headers: { 'content-type': 'application/json', ...auth(token) },
      payload: { preAnalysisId: preId, postAnalysisId: postId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      comparison: { id: string; comparisonSummary: string };
      result: { newDamage: unknown[]; preExisting: unknown[]; inconclusive: unknown[] };
    };
    expect(body.result.newDamage).toHaveLength(5);
    expect(body.result.preExisting).toHaveLength(1);
    expect(body.result.inconclusive).toHaveLength(2);
    expect(body.comparison.comparisonSummary).toContain('5 new');
  });

  it('re-comparing the same pair is idempotent (same row updated)', async () => {
    const first = (await ctx.app
      .inject({
        method: 'POST',
        url: '/damage-analysis/compare',
        headers: { 'content-type': 'application/json', ...auth(token) },
        payload: { preAnalysisId: preId, postAnalysisId: postId },
      })
      .then((r) => r.json())) as { comparison: { id: string } };
    const second = (await ctx.app
      .inject({
        method: 'POST',
        url: '/damage-analysis/compare',
        headers: { 'content-type': 'application/json', ...auth(token) },
        payload: { preAnalysisId: preId, postAnalysisId: postId },
      })
      .then((r) => r.json())) as { comparison: { id: string } };
    expect(second.comparison.id).toBe(first.comparison.id);
  });

  it('streams an analysis report PDF', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/damage-analysis/${preId}/report.pdf`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('worker tick runs without error and reports counts', async () => {
    const worker = ctx.app.get(DamageAnalysisWorker);
    const result = await worker.tick();
    expect(typeof result.scanned).toBe('number');
    expect(typeof result.processed).toBe('number');
  });
});
