/**
 * HeavyDutyModule — Heavy-Duty Specialist (Session 36).
 *
 * Wires the operator controller, the orchestration service, and the daily
 * cert-expiry cron. ScheduleModule.forRoot() is idempotent across modules
 * (Impound / AR / DynamicPricing already import it). The cron is exported
 * so integration tests can drive tick() directly.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { HeavyDutyCertExpiryCron } from './heavy-duty-cert-expiry.cron.js';
import { HeavyDutyController } from './heavy-duty.controller.js';
import { HeavyDutyService } from './heavy-duty.service.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [HeavyDutyController],
  providers: [HeavyDutyService, HeavyDutyCertExpiryCron],
  exports: [HeavyDutyService, HeavyDutyCertExpiryCron],
})
export class HeavyDutyModule {}
