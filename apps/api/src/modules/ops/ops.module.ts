/**
 * OpsModule — Phase 0 hardening (Session 17).
 *
 * Hosts platform-operations crons. Currently just BackupVerifyCron (daily
 * DB-backup freshness check → Sentry alert on failure). ConfigService and
 * SentryService come from the global ConfigModule / ObservabilityModule.
 * ScheduleModule.forRoot() is idempotent across modules. The cron is
 * exported so an integration test can drive tick() directly.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BackupVerifyCron } from './backup-verify.cron.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [BackupVerifyCron],
  exports: [BackupVerifyCron],
})
export class OpsModule {}
