/**
 * DamageAnalysisWorker — retry backstop for queued damage runs (Photo
 * Damage Analysis, Session 42).
 *
 * Inline-first processing in DamageAnalysisService handles the common case;
 * this worker drains rows a transient provider failure left in `queued`
 * (or a crash left mid-`processing`), re-invoking the SAME
 * `processAnalysis` path. retry_count < 3 caps the attempts — the 3rd
 * transient failure flips the row to `failed` inside processAnalysis.
 *
 * Gating: DAMAGE_ANALYSIS_WORKER_ENABLED (default false). The @Cron mounts
 * so the schedule is registered, but the tick body short-circuits when
 * disabled — same pattern as ImpoundFeeAccrualCron. `tick()` is public so
 * integration tests drive it synchronously.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { damageAnalyses } from '@ustowdispatch/db';
import { and, inArray, isNull, lt } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { DamageAnalysisService } from './damage-analysis.service.js';

export interface DamageWorkerTickResult {
  scanned: number;
  processed: number;
}

const MAX_RETRIES = 3;

@Injectable()
export class DamageAnalysisWorker {
  private readonly log = new Logger(DamageAnalysisWorker.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
    private readonly service: DamageAnalysisService,
  ) {}

  @Cron('*/2 * * * *')
  async cronTick(): Promise<DamageWorkerTickResult | null> {
    if (!this.config.config.DAMAGE_ANALYSIS_WORKER_ENABLED) {
      this.log.debug('DamageAnalysisWorker: worker disabled by env flag');
      return null;
    }
    return this.tick();
  }

  async tick(): Promise<DamageWorkerTickResult> {
    // Cross-tenant scan of still-owed runs (admin bypasses RLS).
    const candidates = await this.admin.runAsAdmin({}, async (db) =>
      db.query.damageAnalyses.findMany({
        where: and(
          inArray(damageAnalyses.status, ['queued', 'processing']),
          lt(damageAnalyses.retryCount, MAX_RETRIES),
          isNull(damageAnalyses.deletedAt),
        ),
        columns: { id: true },
      }),
    );

    let processed = 0;
    for (const { id } of candidates) {
      try {
        await this.service.processAnalysis(id);
        processed += 1;
      } catch (err) {
        // processAnalysis already persisted the failure/retry state.
        this.log.warn({
          msg: 'damage analysis retry failed',
          analysisId: id,
          err: (err as Error).message,
        });
      }
    }

    const result = { scanned: candidates.length, processed };
    this.log.log({ msg: 'damage analysis worker tick', ...result });
    return result;
  }
}
