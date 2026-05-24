/**
 * RepoModule — Repossession Workflow (core, Session 49).
 *
 * Wires the operator/driver controllers (/lienholders + /repo-cases) and the
 * two orchestration services. DatabaseModule provides the TenantAwareDb the
 * services run RLS-scoped queries through; ConfigService (global) supplies the
 * REPO_MODULE_ENABLED gate the controllers check. No cron this session.
 */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { RepoCaseService } from './repo-case.service.js';
import { LienholderService } from './repo-lienholder.service.js';
import { LienholderController, RepoCaseController } from './repo.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [LienholderController, RepoCaseController],
  providers: [RepoCaseService, LienholderService],
  exports: [RepoCaseService, LienholderService],
})
export class RepoModule {}
