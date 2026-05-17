/**
 * DynamicPricingModule — Moat #1.
 *
 * Wires the controller, the service layer (CRUD + override + save-flow),
 * the read-only TierResolutionService consumed by RateEngineService, and
 * three hourly crons (weather poller, demand surge, auto-revert). The
 * crons are gated by DYNAMIC_PRICING_CRON_ENABLED so they won't fire in
 * dev / CI by default.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { AutoRevertService } from './auto-revert.service.js';
import { DemandSurgeService } from './demand-surge.service.js';
import { DynamicPricingController } from './dynamic-pricing.controller.js';
import { DynamicPricingService } from './dynamic-pricing.service.js';
import { PulseAggregatorService } from './pulse-aggregator.service.js';
import { DynamicPricingReportsService } from './reports.service.js';
import { SaveWorkflowService } from './save-workflow.service.js';
import { TierResolutionService } from './tier-resolution.service.js';
import { WeatherPollerService } from './weather-poller.service.js';

@Module({
  imports: [
    // ScheduleModule.forRoot() is idempotent across modules — the AR
    // module already calls it, but co-locating here keeps the module
    // self-contained.
    ScheduleModule.forRoot(),
    DatabaseModule,
  ],
  controllers: [DynamicPricingController],
  providers: [
    DynamicPricingService,
    TierResolutionService,
    PulseAggregatorService,
    SaveWorkflowService,
    DynamicPricingReportsService,
    WeatherPollerService,
    DemandSurgeService,
    AutoRevertService,
  ],
  exports: [TierResolutionService, PulseAggregatorService, DynamicPricingService],
})
export class DynamicPricingModule {}
