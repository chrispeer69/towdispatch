/**
 * AiDispatchRecomputeCron — AI Smart Dispatch (Session 41).
 *
 * Every 60 seconds, recompute the advisory recommendation set for every
 * unassigned ('new') job, per tenant. ADVISORY ONLY — it writes
 * dispatch_recommendations rows; it NEVER assigns a job or touches dispatch
 * core. Same conservative posture as the lien-advance / HD-cert crons.
 *
 * Gating: AI_DISPATCH_RECOMPUTE_CRON_ENABLED (default false). The @Cron
 * decorator still mounts so the schedule is registered; the tick body
 * short-circuits when disabled. tick() is public so integration tests drive it
 * directly. Cross-tenant tenant discovery runs on the admin pool; the per-tenant
 * recompute runs in tenant context (RLS enforced) with the system actor.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { SmartDispatchService } from './smart-dispatch.service.js';

/** Audit actor for cron-driven tenant-context writes (mirrors report-scheduler). */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export interface RecomputeTickResult {
  tenants: number;
  jobsRecomputed: number;
}

@Injectable()
export class AiDispatchRecomputeCron {
  private readonly log = new Logger(AiDispatchRecomputeCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
    private readonly service: SmartDispatchService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cronTick(): Promise<RecomputeTickResult | null> {
    if (!this.config.aiDispatch.cronEnabled) {
      this.log.debug('AiDispatchRecomputeCron: cron disabled by env flag');
      return null;
    }
    return this.tick();
  }

  /** Public entry point so integration tests can drive a tick synchronously. */
  async tick(): Promise<RecomputeTickResult> {
    const tenantIds = await this.admin.runAsAdmin({}, (db) =>
      this.service.tenantsWithUnassignedJobs(db),
    );

    let jobsRecomputed = 0;
    for (const tenantId of tenantIds) {
      try {
        jobsRecomputed += await this.service.recomputeUnassigned({
          tenantId,
          userId: SYSTEM_USER_ID,
          requestId: `ai-dispatch-cron-${Date.now()}`,
        });
      } catch (err) {
        // One bad tenant must not stall the sweep.
        this.log.warn({
          msg: 'AiDispatchRecomputeCron: tenant recompute failed',
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result: RecomputeTickResult = { tenants: tenantIds.length, jobsRecomputed };
    this.log.log({ msg: 'AI dispatch recompute tick', ...result });
    return result;
  }
}
