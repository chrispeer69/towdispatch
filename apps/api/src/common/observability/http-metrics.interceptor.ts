/**
 * Records every HTTP request into the metrics registry. Labels the route
 * with the matched controller route (not the raw URL) so the histogram
 * cardinality stays bounded.
 *
 * Also logs slow endpoints at WARN. Threshold defaults to 1000ms and is
 * configurable via env.
 */
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { type Observable, tap } from 'rxjs';
import { ConfigService } from '../../config/config.service.js';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly logger: Logger;
  private readonly slowThresholdMs: number;

  constructor(
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.logger = config.logger.child({ component: 'http-metrics' });
    this.slowThresholdMs = config.slowEndpointThresholdMs;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest & { routerPath?: string }>();
    const res = http.getResponse<{ statusCode: number }>();

    const finalize = (): void => {
      const ns = process.hrtime.bigint() - start;
      const durationMs = Number(ns) / 1e6;
      const durationSec = durationMs / 1000;
      const route = (req.routeOptions?.url ?? req.routerPath ?? req.url ?? 'unknown').toString();
      const status = String(res.statusCode ?? 0);
      const method = req.method ?? 'GET';

      this.metrics.httpRequestsTotal.inc({ method, route, status });
      this.metrics.httpRequestDurationSeconds.observe({ method, route, status }, durationSec);

      if (durationMs > this.slowThresholdMs) {
        const c = req.requestContext;
        this.logger.warn(
          {
            method,
            path: req.url,
            route,
            status,
            durationMs: Math.round(durationMs * 100) / 100,
            tenantId: c?.tenantId ?? null,
            requestId: c?.requestId,
            slow: true,
          },
          'slow endpoint',
        );
      }
    };

    return next.handle().pipe(
      tap({
        next: finalize,
        error: finalize,
      }),
    );
  }
}
