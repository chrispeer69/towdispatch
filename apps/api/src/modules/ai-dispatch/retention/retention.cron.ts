/**
 * AiDispatchRetentionCron — daily two-phase purge of the three high-volume
 * ai-dispatch tables (chore/ai-dispatch-retention).
 *
 * Schedule: 03:00 server-time daily (server runs UTC — same slot as
 * LienAdvanceCron). A per-tenant-local 03:00 would need per-tenant cron
 * fan-out keyed on tenants.timezone; that refinement is deferred (UTC is the
 * documented fallback). See AI_DISPATCH_RETENTION_DECISIONS.md.
 *
 * Gating: AI_DISPATCH_RETENTION_CRON_ENABLED (default false). The @Cron
 * decorator still mounts so the schedule registers; the tick body
 * short-circuits when disabled — identical posture to the recompute /
 * lien-advance / HD-cert crons. Default-off means CI and dev never purge.
 *
 * Fan-out: discover live tenants on the admin pool, then run RetentionService
 * per tenant inside its RLS context (RetentionService.runForTenantAsSystem).
 * One bad tenant is logged and skipped — it never stalls the sweep.
 *
 * Per run we emit a structured summary log line (the cron-run audit record;
 * the actual row deletions are captured by the AFTER-DELETE audit trigger) and
 * a Sentry breadcrumb so a later error has the sweep in its trail.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SentryService } from '../../../common/observability/sentry.service.js';
import { ConfigService } from '../../../config/config.service.js';
import { RetentionService } from './retention.service.js';

export interface RetentionSweepResult {
  tenants: number;
  tenantsFailed: number;
  softDeleted: number;
  hardDeleted: number;
  ranAt: string;
}

@Injectable()
export class AiDispatchRetentionCron {
  private readonly log = new Logger(AiDispatchRetentionCron.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly config: ConfigService,
    private readonly sentry: SentryService,
  ) {}

  @Cron('0 3 * * *')
  async cronTick(): Promise<RetentionSweepResult | null> {
    if (!this.config.aiDispatch.retentionCronEnabled) {
      this.log.debug('AiDispatchRetentionCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests can drive the sweep directly. */
  async tick(now: Date = new Date()): Promise<RetentionSweepResult> {
    const tenantIds = await this.retention.allTenantIds();

    let softDeleted = 0;
    let hardDeleted = 0;
    let tenantsFailed = 0;

    for (const tenantId of tenantIds) {
      try {
        const result = await this.retention.runForTenantAsSystem(tenantId, { now });
        for (const t of result.tables) {
          softDeleted += t.softDeleted;
          hardDeleted += t.hardDeleted;
        }
      } catch (err) {
        // One bad tenant must not stall the sweep.
        tenantsFailed += 1;
        this.log.warn({
          msg: 'AiDispatchRetentionCron: tenant retention failed',
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result: RetentionSweepResult = {
      tenants: tenantIds.length,
      tenantsFailed,
      softDeleted,
      hardDeleted,
      ranAt: now.toISOString(),
    };
    this.log.log({ msg: 'AI dispatch retention sweep', ...result });
    this.sentry.addBreadcrumb('ai-dispatch.retention', 'retention sweep complete', { ...result });
    return result;
  }
}
