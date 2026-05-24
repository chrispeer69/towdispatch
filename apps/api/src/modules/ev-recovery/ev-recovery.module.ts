/**
 * EvRecoveryModule — EV-Specific Recovery Workflows (Session 48).
 *
 * Wires the operator controller and the driver-JWT controller onto one
 * EvRecoveryService. AuthModule supplies JwtService for the DriverAuthGuard
 * (reused from the driver-experience module); DatabaseModule supplies the
 * tenant-aware DB handle. No cron this session.
 */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DriverAuthGuard } from '../driver-experience/driver-auth.guard.js';
import { DriverEvController } from './driver-ev.controller.js';
import { EvRecoveryController } from './ev-recovery.controller.js';
import { EvRecoveryService } from './ev-recovery.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [EvRecoveryController, DriverEvController],
  providers: [EvRecoveryService, DriverAuthGuard],
  exports: [EvRecoveryService],
})
export class EvRecoveryModule {}
