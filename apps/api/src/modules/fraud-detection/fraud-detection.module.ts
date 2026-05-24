/**
 * FraudDetectionModule — Fraud Detection on Motor Club Disputes (Session 43).
 *
 * Wires the operator-side controller, the scoring/dispute service, and the
 * env-gated nightly re-score cron. ScheduleModule.forRoot() is idempotent
 * across modules (Impound / Lien / AR / TierOffers already import it). The
 * cron is exported so integration tests can drive tick().
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { FraudDetectionController } from './fraud-detection.controller.js';
import { FraudDetectionService } from './fraud-detection.service.js';
import { FraudScoreCron } from './fraud-score.cron.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [FraudDetectionController],
  providers: [FraudDetectionService, FraudScoreCron],
  exports: [FraudDetectionService, FraudScoreCron],
})
export class FraudDetectionModule {}
