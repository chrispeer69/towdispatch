import { Global, Module } from '@nestjs/common';
import { DispatchEventsService } from './dispatch-events.service.js';

/**
 * Global so JobsService and ShiftsService can both publish events without
 * the importing modules taking on a DispatchModule dependency (which would
 * be circular — DispatchModule depends on JobsModule for JobsService).
 */
@Global()
@Module({
  providers: [DispatchEventsService],
  exports: [DispatchEventsService],
})
export class DispatchEventsModule {}
