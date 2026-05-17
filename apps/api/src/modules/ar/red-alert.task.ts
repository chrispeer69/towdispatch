/**
 * Hourly tick that drives the Monday 6:00 AM RED ALERT (MOAT #7).
 *
 * The decorator runs every hour on the hour. We can't pin a single UTC
 * time because tenants live in many timezones — instead, every tick
 * asks "is it 6 AM Monday in this tenant's local zone?" inside
 * RedAlertService.maybeSendForTenant.
 *
 * The hourly cadence + per-tenant TZ check is a deliberate tradeoff:
 * simpler than per-tenant scheduling, harder to drop (any single tick
 * succeeding is enough to trigger Monday's send), at the cost of
 * running 23 zero-result ticks every weekday.
 *
 * Disabled in development unless RED_ALERT_CRON_ENABLED=true so a local
 * dev server doesn't spam mailhog with synthesized past-due summaries.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '../../config/config.service.js';
import { RedAlertService } from './red-alert.service.js';

@Injectable()
export class RedAlertTask {
  private readonly log = new Logger(RedAlertTask.name);

  constructor(
    private readonly redAlert: RedAlertService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!this.shouldRun()) return;
    try {
      const result = await this.redAlert.runHourlyTick();
      // Only log when something actually happened — 23/day zero-result
      // ticks would otherwise drown the log.
      if (result.sent > 0 || result.failed > 0) {
        this.log.log(
          `red-alert tick: tenants=${result.tenants} sent=${result.sent} failed=${result.failed}`,
        );
      }
    } catch (err) {
      this.log.error(`red-alert tick failed: ${String(err)}`);
    }
  }

  private shouldRun(): boolean {
    // Always-on in production, opt-in in dev.
    if (this.config.nodeEnv === 'production') return true;
    return process.env.RED_ALERT_CRON_ENABLED === 'true';
  }
}
