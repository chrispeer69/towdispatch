/**
 * Prometheus metrics. One registry per process. Default Node metrics
 * (event loop lag, GC, memory, file descriptors) plus our own counters
 * and histograms for HTTP and DB.
 *
 * Read via GET /metrics. Scrapeable by Prometheus or any agent that
 * speaks the text exposition format.
 */
import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status'>;
  readonly dbQueryDurationSeconds: Histogram<'op'>;
  readonly authLoginsTotal: Counter<'outcome'>;
  readonly authLockoutsTotal: Counter<never>;
  readonly importRunsTotal: Counter<'mode' | 'status'>;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry, prefix: 'towcommand_api_' });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests by method, route, status.',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds.',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.dbQueryDurationSeconds = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Database query duration in seconds.',
      labelNames: ['op'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.authLoginsTotal = new Counter({
      name: 'auth_logins_total',
      help: 'Auth login attempts by outcome.',
      labelNames: ['outcome'],
      registers: [this.registry],
    });

    this.authLockoutsTotal = new Counter({
      name: 'auth_lockouts_total',
      help: 'Account lockouts triggered by brute-force detector.',
      registers: [this.registry],
    });

    this.importRunsTotal = new Counter({
      name: 'import_runs_total',
      help: 'Towbook importer runs by mode and final status.',
      labelNames: ['mode', 'status'],
      registers: [this.registry],
    });
  }

  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
