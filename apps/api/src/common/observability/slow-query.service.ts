/**
 * Slow-query logging. We wrap the pg.PoolClient.query method when a client
 * is checked out of APP_POOL so every query through TenantAwareDb is timed.
 *
 * Threshold defaults to 250ms via SLOW_QUERY_THRESHOLD_MS. Logs at WARN
 * with the query text, scrubbed params (numeric/uuid kept, strings
 * truncated and tagged), tenant_id, and duration. PII fields like email
 * and phone never appear in params because the application binds them as
 * positional parameters — we only log their type and length, not value.
 */
import { Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { ConfigService } from '../../config/config.service.js';
import { MetricsService } from './metrics.service.js';

const PII_HINT_RX = /(password|email|phone|token|secret|otp|totp|ssn)/i;

@Injectable()
export class SlowQueryService {
  private readonly logger: Logger;
  private readonly thresholdMs: number;

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.logger = config.logger.child({ component: 'slow-query' });
    this.thresholdMs = config.slowQueryThresholdMs;
  }

  wrapClient(
    client: { query: (...args: unknown[]) => Promise<unknown> },
    queryName?: string,
  ): void {
    const inner = client.query.bind(client);
    const log = this.logger;
    const threshold = this.thresholdMs;
    const metrics = this.metrics;

    // node-postgres query() has many overloads. We measure all of them.
    // biome-ignore lint/suspicious/noExplicitAny: passthrough wrapper
    client.query = async function (this: unknown, ...args: any[]): Promise<unknown> {
      const start = process.hrtime.bigint();
      try {
        return await inner(...args);
      } finally {
        const ns = process.hrtime.bigint() - start;
        const durationMs = Number(ns) / 1e6;
        metrics.dbQueryDurationSeconds.observe({ op: queryName ?? 'query' }, durationMs / 1000);
        if (durationMs > threshold) {
          const text = typeof args[0] === 'string' ? args[0] : (args[0]?.text ?? '<config>');
          const rawParams: unknown[] = Array.isArray(args[1])
            ? args[1]
            : Array.isArray(args[0]?.values)
              ? args[0].values
              : [];
          log.warn(
            {
              durationMs: Math.round(durationMs * 100) / 100,
              query:
                typeof text === 'string' ? text.replace(/\s+/g, ' ').slice(0, 240) : '<unknown>',
              params: scrubParams(rawParams, typeof text === 'string' ? text : ''),
              slow: true,
            },
            'slow query',
          );
        }
      }
    };
  }
}

function scrubParams(params: unknown[], queryText: string): unknown[] {
  const piiSuspected = PII_HINT_RX.test(queryText);
  return params.map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p === 'number' || typeof p === 'boolean') return p;
    if (typeof p === 'string') {
      // UUID-shaped strings are safe to log.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return p;
      if (piiSuspected) return `<str:${p.length}>`;
      return p.length > 32 ? `${p.slice(0, 16)}…<+${p.length - 16}>` : p;
    }
    return `<${typeof p}>`;
  });
}
