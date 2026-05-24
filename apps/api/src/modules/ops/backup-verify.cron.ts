/**
 * BackupVerifyCron — Phase 0 hardening (Session 17).
 *
 * Once a day (03:00 server time) it asks the platform for the timestamp of
 * the most recent automated DB backup and asserts it is younger than
 * BACKUP_MAX_AGE_HOURS. On failure — stale backup, or backup metadata that
 * can't be fetched — it raises a Sentry alert (captureMessage) so on-call is
 * paged before a missing backup is discovered during an actual incident.
 *
 * Gating: BACKUP_VERIFY_CRON_ENABLED (default false). The @Cron decorator
 * still registers the schedule, but the tick body short-circuits when
 * disabled — same pattern as ImpoundFeeAccrualCron / TierOfferLifecycleCron.
 *
 * Backup-metadata source: the platform is Railway managed Postgres. Reading
 * the latest-backup timestamp requires the Railway API (RAILWAY_API_TOKEN +
 * project/service ids). Until that API call is wired against the live
 * project, `fetchLastBackupAt` returns null when the token is unset, which
 * the pure assessment treats as a FAILED verification (an unverifiable
 * backup is not a passing one) — fail closed, never silently pass. See
 * SESSION_17_DECISIONS.md for the Railway-API follow-up.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SentryService } from '../../common/observability/sentry.service.js';
import { ConfigService } from '../../config/config.service.js';
import { type BackupFreshness, assessBackupFreshness } from './backup-verify.logic.js';

export interface BackupVerifyResult extends BackupFreshness {
  source: string;
  checkedAt: string;
}

@Injectable()
export class BackupVerifyCron {
  private readonly log = new Logger(BackupVerifyCron.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sentry: SentryService,
  ) {}

  @Cron('0 3 * * *')
  async cronTick(): Promise<BackupVerifyResult | null> {
    if (!this.config.backupVerify.cronEnabled) {
      this.log.debug('BackupVerifyCron: disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so an integration test / the CLI can drive it. */
  async tick(now: Date = new Date()): Promise<BackupVerifyResult> {
    const { maxAgeHours } = this.config.backupVerify;
    const { at, source } = await this.fetchLastBackupAt();
    const freshness = assessBackupFreshness(at, now, maxAgeHours);
    const result: BackupVerifyResult = {
      ...freshness,
      source,
      checkedAt: now.toISOString(),
    };

    if (freshness.ok) {
      this.log.log({ msg: 'backup verify ok', ...result });
    } else {
      this.log.error({ msg: 'backup verify FAILED', ...result });
      // Alert. Tagged so an alert rule can route backup failures to the
      // ops channel rather than the generic crash firehose.
      this.sentry.captureMessage('alert:backup_verify_failed', {
        reason: result.reason,
        ageHours: result.ageHours,
        maxAgeHours,
        source,
      });
    }
    return result;
  }

  /**
   * Fetch the most-recent-backup timestamp from the platform. Returns null
   * when it cannot be determined (treated as a failed verification upstream).
   */
  private async fetchLastBackupAt(): Promise<{ at: Date | null; source: string }> {
    const token = this.config.backupVerify.railwayApiToken;
    if (!token) {
      this.log.warn(
        'BackupVerifyCron: RAILWAY_API_TOKEN not set — cannot fetch backup metadata (failing closed)',
      );
      return { at: null, source: 'unconfigured' };
    }
    // TODO(ops): call the Railway backups API and parse the latest backup
    // createdAt. Deliberately not guessed here — see SESSION_17_DECISIONS.md.
    // Until wired, a configured token still fails closed rather than guess.
    this.log.warn('BackupVerifyCron: Railway backup-metadata fetch not yet wired (failing closed)');
    return { at: null, source: 'railway-api-unwired' };
  }
}
