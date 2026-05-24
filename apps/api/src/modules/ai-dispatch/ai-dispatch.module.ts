/**
 * AiDispatchModule — AI Smart Dispatch + Predictive ETAs (Session 41).
 *
 * Wires the operator controller and the driver-JWT controller onto one
 * SmartDispatchService, plus the env-gated recompute cron. DatabaseModule
 * supplies the tenant-aware DB handle + the admin TransactionRunner; AuthModule
 * supplies JwtService for the DriverAuthGuard (reused from driver-experience).
 * ScheduleModule.forRoot() is idempotent across modules.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DriverAuthGuard } from '../driver-experience/driver-auth.guard.js';
import { AiDispatchRecomputeCron } from './ai-dispatch-recompute.cron.js';
import { AiDispatchController } from './ai-dispatch.controller.js';
import { DriverDispatchController } from './driver-dispatch.controller.js';
import { AdminRetentionController } from './retention/admin-retention.controller.js';
import { AiDispatchRetentionCron } from './retention/retention.cron.js';
import { RetentionService } from './retention/retention.service.js';
import { SmartDispatchService } from './smart-dispatch.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [AiDispatchController, DriverDispatchController, AdminRetentionController],
  providers: [
    SmartDispatchService,
    AiDispatchRecomputeCron,
    RetentionService,
    AiDispatchRetentionCron,
    DriverAuthGuard,
  ],
  exports: [SmartDispatchService, RetentionService],
})
export class AiDispatchModule {}
