/**
 * Integration tests for Fraud Detection (Session 43) — drives the real HTTP
 * surface against the docker stack (Postgres + Redis). Covers:
 *   - scoreJob on a synthetic job seeded with 3 known anomalies (excessive
 *     mileage + missing evidence + rapid resequencing) → score in the
 *     expected band, signals persisted,
 *   - the dispute lifecycle: record → resolve (won) → ground-truth outcome,
 *   - the per-club dispute stats report,
 *   - the FRAUD_SCORE_CRON_ENABLED nightly sweep (re-scores invoiced jobs).
 *
 * Synthetic job + invoice + line items + status transitions are seeded via the
 * admin pool. DB-gated via skipIfNoDb; cleans up its own rows before tearDown.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FraudScoreCron } from '../../src/modules/fraud-detection/fraud-score.cron.js';
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

describeIfDb('integration — fraud detection', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let tenantId: string;
  let token: string;
  const tenantIds: string[] = [];

  function inject(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return ctx.app.inject({
      method,
      url,
      headers: { ...auth(token), 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  /** Seed a job that fires excessive_mileage + missing_evidence + rapid_resequencing. */
  async function seedScorableJob(jobNumber: string): Promise<string> {
    const jobId = uuidv7();
    const invoiceId = uuidv7();
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by, authorized_by_name, intow_miles)
         VALUES ($1, $2, $3, 'tow', '100 Tow Way', 'motor_club', 'Agero', 10)`,
        [jobId, tenantId, jobNumber],
      );
      // Invoice over the missing-evidence threshold ($800), no evidence photos.
      await c.query(
        `INSERT INTO invoices (id, tenant_id, invoice_number, invoice_type, status, job_id, total_cents, issued_at)
         VALUES ($1, $2, $3, 'motor_club_submission', 'issued', $4, 80000, now())`,
        [invoiceId, tenantId, `INV-${jobNumber}`, jobId],
      );
      // Billed loaded miles 50 vs geocoded 10 ⇒ ratio 5 (excessive_mileage).
      await c.query(
        `INSERT INTO invoice_line_items (id, tenant_id, invoice_id, line_number, line_type, description, quantity)
         VALUES ($1, $2, $3, 1, 'mileage_loaded', 'Loaded miles', '50')`,
        [uuidv7(), tenantId, invoiceId],
      );
      // 4 back-and-forth reversals (in_progress → dispatched) ⇒ rapid_resequencing.
      for (let i = 0; i < 4; i++) {
        await c.query(
          `INSERT INTO job_status_transitions (id, tenant_id, job_id, from_status, to_status)
           VALUES ($1, $2, $3, 'in_progress', 'dispatched')`,
          [uuidv7(), tenantId, jobId],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    return jobId;
  }

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('fraud', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    tenantIds.push(tenantId);
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const table of [
          'dispute_outcomes',
          'dispute_records',
          'fraud_risk_scores',
          'fraud_risk_signals',
          'invoice_line_items',
          'invoices',
          'job_status_transitions',
          'jobs',
        ]) {
          await c.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('scores a job with 3 known anomalies into at least the medium band', async () => {
    const jobId = await seedScorableJob('20260524-9001');
    const res = await inject('POST', `/fraud-detection/jobs/${jobId}/score`);
    expect(res.statusCode, res.body).toBe(201);
    const detail = res.json() as {
      score: { score0100: number; riskBand: string } | null;
      signals: { signalType: string }[];
    };
    const types = detail.signals.map((s) => s.signalType).sort();
    expect(types).toEqual(['excessive_mileage', 'missing_evidence', 'rapid_resequencing']);
    expect(detail.score).not.toBeNull();
    expect(detail.score?.score0100).toBeGreaterThan(0);
    expect(['medium', 'high', 'critical']).toContain(detail.score?.riskBand);
  });

  it('surfaces the scored job in the risk queue (band filter)', async () => {
    const list = await inject('GET', '/fraud-detection/high-risk?band=medium&days=1');
    expect(list.statusCode, list.body).toBe(200);
    const items = list.json() as { job: { jobNumber: string } }[];
    expect(items.some((i) => i.job.jobNumber === '20260524-9001')).toBe(true);
  });

  it('records, resolves, and reports a dispute with ground-truth feedback', async () => {
    const jobId = await seedScorableJob('20260524-9002');
    await inject('POST', `/fraud-detection/jobs/${jobId}/score`);

    const rec = await inject('POST', '/fraud-detection/disputes', {
      jobId,
      motorClubName: 'Agero',
      disputeType: 'pricing',
      amountDisputedCents: 50000,
    });
    expect(rec.statusCode, rec.body).toBe(201);
    const disputeId = (rec.json() as { id: string; status: string }).id;
    expect((rec.json() as { status: string }).status).toBe('open');

    const resolved = await inject('POST', `/fraud-detection/disputes/${disputeId}/resolve`, {
      status: 'won',
      resolutionAmountCents: 50000,
    });
    expect(resolved.statusCode, resolved.body).toBe(201);
    expect((resolved.json() as { status: string }).status).toBe('won');

    // A second resolve is rejected (already terminal).
    const reResolve = await inject('POST', `/fraud-detection/disputes/${disputeId}/resolve`, {
      status: 'lost',
    });
    expect(reResolve.statusCode).toBe(409);

    const outcome = await inject('POST', `/fraud-detection/disputes/${disputeId}/outcome`, {
      wasFraud: true,
    });
    expect(outcome.statusCode, outcome.body).toBe(201);
    expect((outcome.json() as { wasFraud: boolean }).wasFraud).toBe(true);

    const stats = await inject('GET', '/fraud-detection/reports/dispute-stats?days=90');
    expect(stats.statusCode, stats.body).toBe(200);
    const agero = (
      stats.json() as { clubs: { motorClubName: string; won: number; winRatePct: number | null }[] }
    ).clubs.find((c) => c.motorClubName === 'Agero');
    expect(agero?.won).toBeGreaterThanOrEqual(1);
    expect(agero?.winRatePct).toBe(100);
  });

  it('re-scores invoiced jobs through the observation cron tick', async () => {
    const cron = ctx.app.get(FraudScoreCron);
    const tick = await cron.tick(new Date());
    // Both seeded jobs carry an invoice issued in the last 24h.
    expect(tick.jobsScanned).toBeGreaterThanOrEqual(2);
    expect(tick.scored).toBeGreaterThanOrEqual(2);
    expect(tick.failed).toBe(0);
  });
});
