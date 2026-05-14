/**
 * MetricsService unit coverage. The integration of HttpMetricsInterceptor
 * with Fastify lives in the integration tier; here we assert the registry
 * is wired correctly so /metrics returns a parseable exposition.
 */
import { describe, expect, it } from 'vitest';
import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('exposes a Prometheus registry with default node metrics', async () => {
    const m = new MetricsService();
    const snapshot = await m.snapshot();
    expect(snapshot).toContain('ustowdispatch_api_process_cpu_user_seconds_total');
    expect(snapshot).toContain('http_requests_total');
    expect(snapshot).toContain('http_request_duration_seconds');
    expect(snapshot).toContain('db_query_duration_seconds');
  });

  it('counts http requests with method/route/status labels', async () => {
    const m = new MetricsService();
    m.httpRequestsTotal.inc({ method: 'GET', route: '/customers', status: '200' });
    m.httpRequestsTotal.inc({ method: 'GET', route: '/customers', status: '200' });
    m.httpRequestsTotal.inc({ method: 'POST', route: '/customers', status: '201' });
    const snap = await m.snapshot();
    expect(snap).toMatch(/http_requests_total\{method="GET",route="\/customers",status="200"\} 2/);
    expect(snap).toMatch(/http_requests_total\{method="POST",route="\/customers",status="201"\} 1/);
  });

  it('observes db query durations into the histogram', async () => {
    const m = new MetricsService();
    m.dbQueryDurationSeconds.observe({ op: 'query' }, 0.012);
    const snap = await m.snapshot();
    expect(snap).toContain('db_query_duration_seconds_bucket{le="0.025",op="query"} 1');
  });
});
