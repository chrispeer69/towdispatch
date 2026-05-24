import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DriverAuthGuard } from '../driver-experience/driver-auth.guard.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { VoiceDriverController } from './voice-driver.controller.js';
import { VoiceDriverService } from './voice-driver.service.js';

/**
 * Voice-Controlled Driver Workflows (Session 45).
 *
 * Imports JobsModule for JobsService.transition (no duplicated job logic),
 * AuthModule for the driver-JWT verification the DriverAuthGuard performs,
 * and DatabaseModule for the tenant-aware voice_command_log writes.
 */
@Module({
  imports: [DatabaseModule, AuthModule, JobsModule],
  controllers: [VoiceDriverController],
  providers: [VoiceDriverService, DriverAuthGuard],
  exports: [VoiceDriverService],
})
export class VoiceDriverModule {}
