/**
 * LienProcessingModule — Lien Processing (Session 23).
 *
 * Wires the operator-side controller, the orchestration service, the PDF
 * form renderer, and the env-gated nightly advance cron. ScheduleModule
 * .forRoot() is idempotent across modules (Impound / AR / TierOffers already
 * import it). The cron is exported so integration tests can drive tick().
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { LienFormPdfService } from './forms/lien-form.renderer.js';
import { LienAdvanceCron } from './lien-advance.cron.js';
import { LienProcessingController } from './lien-processing.controller.js';
import { LienProcessingService } from './lien-processing.service.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [LienProcessingController],
  providers: [LienProcessingService, LienFormPdfService, LienAdvanceCron],
  exports: [LienProcessingService, LienAdvanceCron],
})
export class LienProcessingModule {}
