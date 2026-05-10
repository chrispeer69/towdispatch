import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchGateway } from './dispatch.gateway.js';
import { DriversService } from './drivers.service.js';

/**
 * The dispatch module owns the live board: HTTP feed, Socket.IO gateway,
 * and the driver/shift mutation surface. JobsModule re-exports JobsService
 * for the controller; DispatchEventsModule (global) is the in-process bus
 * the gateway listens to.
 */
@Module({
  imports: [JobsModule, AuthModule],
  controllers: [DispatchController],
  providers: [DriversService, DispatchGateway],
  exports: [DispatchGateway],
})
export class DispatchModule {}
