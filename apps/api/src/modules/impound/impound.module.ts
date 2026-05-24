/**
 * ImpoundModule — Impound & Storage (Session 22).
 *
 * Wires the operator-side controller, the orchestration service, and the
 * daily fee-accrual cron. ScheduleModule.forRoot() is idempotent across
 * modules (AR / DynamicPricing / TierOffers already import it); including
 * it keeps the accrual cron self-contained. The cron is exported so
 * integration tests can drive tick() directly.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { ImpoundFeeAccrualCron } from './impound-fee-accrual.cron.js';
import { ImpoundController } from './impound.controller.js';
import { ImpoundService } from './impound.service.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [ImpoundController],
  providers: [ImpoundService, ImpoundFeeAccrualCron],
  exports: [ImpoundService, ImpoundFeeAccrualCron],
})
export class ImpoundModule {}
