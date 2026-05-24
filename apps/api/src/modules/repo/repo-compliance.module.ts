/**
 * RepoComplianceModule — Repo Compliance (Session 50).
 *
 * Wires the operator-side controller, the orchestration service, the PDF form
 * renderer, and the env-gated nightly advance cron. ScheduleModule.forRoot()
 * is idempotent across modules (Lien / Impound / TierOffers already import it).
 * The cron is exported so integration tests can drive tick().
 *
 * Self-contained: no dependency on the S49 RepoCaseService (not on master).
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { RepoComplianceAdvanceCron } from './compliance/repo-advance.cron.js';
import { RepoComplianceController } from './compliance/repo-compliance.controller.js';
import { RepoComplianceService } from './compliance/repo-compliance.service.js';
import { RepoFormPdfService } from './forms/repo-form.renderer.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [RepoComplianceController],
  providers: [RepoComplianceService, RepoFormPdfService, RepoComplianceAdvanceCron],
  exports: [RepoComplianceService, RepoComplianceAdvanceCron],
})
export class RepoComplianceModule {}
