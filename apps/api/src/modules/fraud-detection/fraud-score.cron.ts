/**
 * FraudScoreCron — Fraud Detection (Session 43).
 *
 * Runs once a day (03:30 server time). It re-scores every job whose invoice
 * was issued in the last 24h so the risk queue reflects freshly-billed work.
 *
 * Gating: FRAUD_SCORE_CRON_ENABLED env flag (default false). The @Cron
 * decorator still mounts so the schedule registers, but the tick body
 * short-circuits when disabled — same pattern as LienAdvanceCron.
 *
 * The candidate (tenant, job) pairs are enumerated cross-tenant via the admin
 * pool (an invoice sweep), then each job is scored through the tenant-aware
 * service so RLS + the pure detectors run exactly as they do for a manual
 * score. Each job is scored in its own transaction; one failure never aborts
 * the sweep. ADVISORY ONLY — scoring never blocks or mutates an invoice.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { FraudDetectionService } from './fraud-detection.service.js';

const DAY_MS = 86_400_000;

export interface FraudScoreTickResult {
  jobsScanned: number;
  scored: number;
  failed: number;
}

interface Candidate {
  tenantId: string;
  jobId: string;
}

@Injectable()
export class FraudScoreCron {
  private readonly log = new Logger(FraudScoreCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
    private readonly service: FraudDetectionService,
  ) {}

  @Cron('30 3 * * *')
  async cronTick(): Promise<FraudScoreTickResult | null> {
    if (!this.config.config.FRAUD_SCORE_CRON_ENABLED) {
      this.log.debug('FraudScoreCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests can drive the sweep directly. */
  async tick(now: Date = new Date()): Promise<FraudScoreTickResult> {
    const result: FraudScoreTickResult = { jobsScanned: 0, scored: 0, failed: 0 };
    const since = new Date(now.getTime() - DAY_MS);

    // Cross-tenant enumeration via the admin pool: jobs invoiced in the window.
    const candidates = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ tenant_id: string; job_id: string }>(
        `SELECT DISTINCT tenant_id, job_id
           FROM invoices
          WHERE job_id IS NOT NULL
            AND deleted_at IS NULL
            AND issued_at IS NOT NULL
            AND issued_at >= $1`,
        [since.toISOString()],
      );
      return r.rows.map((row): Candidate => ({ tenantId: row.tenant_id, jobId: row.job_id }));
    });
    result.jobsScanned = candidates.length;

    for (const c of candidates) {
      try {
        await this.service.scoreJob(
          { tenantId: c.tenantId, userId: '', requestId: 'fraud-score-cron' },
          c.jobId,
        );
        result.scored += 1;
      } catch (err) {
        result.failed += 1;
        this.log.error({
          msg: 'fraud score sweep failed for job',
          jobId: c.jobId,
          tenantId: c.tenantId,
          err: (err as Error).message,
        });
        // Continue — one job's failure must not abort the sweep.
      }
    }

    this.log.log({ msg: 'fraud score tick', ...result });
    return result;
  }
}
