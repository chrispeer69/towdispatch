import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller.js';

/**
 * Hosts the guarded /_debug/boom endpoint. ConfigService and SentryService
 * come from the global ConfigModule / ObservabilityModule, so no providers
 * are declared here.
 */
@Module({
  controllers: [DebugController],
})
export class DebugModule {}
