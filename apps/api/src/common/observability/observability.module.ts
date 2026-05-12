/**
 * Observability wiring. Provides MetricsService, SentryService, and the
 * /health /ready /metrics endpoints. The HttpMetricsInterceptor records
 * every request into the metrics registry.
 *
 * Sentry init runs lazily — if SENTRY_DSN is empty the service is a no-op.
 */
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthMetricsController } from './health-metrics.controller.js';
import { HttpMetricsInterceptor } from './http-metrics.interceptor.js';
import { MetricsService } from './metrics.service.js';
import { SentryService } from './sentry.service.js';
import { SlowQueryService } from './slow-query.service.js';

@Global()
@Module({
  controllers: [HealthMetricsController],
  providers: [
    MetricsService,
    SentryService,
    SlowQueryService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [MetricsService, SentryService, SlowQueryService],
})
export class ObservabilityModule {}
