/**
 * RegionModule (Session 44). @Global so RegionContextService is injectable
 * anywhere — notably the HealthMetricsController (in ObservabilityModule),
 * which appends the region block to GET /ready.
 *
 * The Fastify write-guard hooks are registered separately in main.ts
 * (registerRegionGuards) because they attach to the raw Fastify instance, not
 * the Nest DI graph.
 */
import { Global, Module } from '@nestjs/common';
import { RegionContextService } from './region-context.service.js';
import { RegionController } from './region.controller.js';

@Global()
@Module({
  controllers: [RegionController],
  providers: [RegionContextService],
  exports: [RegionContextService],
})
export class RegionModule {}
