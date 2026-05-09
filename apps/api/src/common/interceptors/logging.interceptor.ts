/**
 * Structured access logging. One log line per completed request, with:
 *   method, path, status, duration_ms, request_id, tenant_id, user_id, ip
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

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<{ statusCode: number }>();

    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, start),
        error: () => this.log(req, res, start, 'error'),
      }),
    );
  }

  private log(
    req: FastifyRequest,
    res: { statusCode: number },
    start: bigint,
    level: 'info' | 'error' = 'info',
  ): void {
    const ns = process.hrtime.bigint() - start;
    const durationMs = Number(ns) / 1e6;
    const c = req.requestContext;
    this.logger[level](
      {
        method: req.method,
        path: req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: c?.requestId,
        tenantId: c?.tenantId ?? null,
        userId: c?.userId ?? null,
        ip: c?.ipAddress ?? null,
      },
      'http',
    );
  }
}
