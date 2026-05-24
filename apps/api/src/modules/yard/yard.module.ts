/**
 * YardModule — Yard Management (Session 54). Wires the facility / stall /
 * gate-search / rate-card / billing / release surfaces, plus the daily
 * storage auto-billing cron. ScheduleModule.forRoot() is idempotent across
 * modules (impound / AR / tier-offers already import it). The cron + billing
 * service are exported so integration tests can drive tick()/runForTenant()
 * directly. DispatchEventsService comes from the global DispatchEventsModule.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { StorageBillingController } from './billing/storage-billing.controller.js';
import { StorageAutoBillingCron } from './billing/storage-billing.cron.js';
import { StorageBillingService } from './billing/storage-billing.service.js';
import { GateSearchService } from './gate-search.service.js';
import { RateCardController } from './rate-cards/rate-card.controller.js';
import { RateCardService } from './rate-cards/rate-card.service.js';
import { ReleaseWorkflowService } from './release/release-workflow.service.js';
import { ReleaseController } from './release/release.controller.js';
import { YardEnabledGuard } from './yard-enabled.guard.js';
import { YardFacilityService } from './yard-facility.service.js';
import { YardStallService } from './yard-stall.service.js';
import { YardController } from './yard.controller.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [YardController, RateCardController, StorageBillingController, ReleaseController],
  providers: [
    YardFacilityService,
    YardStallService,
    GateSearchService,
    RateCardService,
    StorageBillingService,
    StorageAutoBillingCron,
    ReleaseWorkflowService,
    YardEnabledGuard,
  ],
  exports: [
    YardFacilityService,
    YardStallService,
    RateCardService,
    StorageBillingService,
    StorageAutoBillingCron,
    ReleaseWorkflowService,
  ],
})
export class YardModule {}
