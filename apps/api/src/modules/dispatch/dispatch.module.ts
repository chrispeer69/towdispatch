import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchGateway } from './dispatch.gateway.js';
import { DriverMobileService } from './driver-mobile.service.js';
import { DriversService } from './drivers.service.js';

/**
 * The dispatch module owns the live board: HTTP feed, Socket.IO gateway,
 * and the driver/shift mutation surface. JobsModule re-exports JobsService
 * for the controller; DispatchEventsModule (global) is the in-process bus
 * the gateway listens to. FleetModule is imported so DriverMobileService
 * can write photo uploads through DocumentsService (Session 7 driver app).
 */
@Module({
  imports: [JobsModule, AuthModule, FleetModule],
  controllers: [DispatchController],
  providers: [DriversService, DriverMobileService, DispatchGateway],
  // DriversService is exported so DriverExperienceModule's
  // DriverShiftService can reuse the existing startShift/endShift
  // logic instead of duplicating shift creation. Adding it to the
  // public surface is intentional — see Session 2 driver-shift
  // service for the consumer.
  exports: [DispatchGateway, DriversService],
})
export class DispatchModule {}
