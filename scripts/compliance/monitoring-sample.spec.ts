import { describe, expect, it } from 'vitest';
import { type HealthSample, evaluateHealthSample } from './monitoring-sample';

const sample = (over: Partial<HealthSample>): HealthSample => ({
  url: 'http://localhost:3001/health',
  reachable: true,
  httpStatus: 200,
  latencyMs: 12,
  reportedStatus: 'ok',
  ...over,
});

describe('evaluateHealthSample', () => {
  it('positive: 200 + ok body → ok', () => {
    expect(evaluateHealthSample(sample({}), false).result.status).toBe('ok');
  });

  it('positive: 200 + no body status → ok (HTTP carries the signal)', () => {
    expect(evaluateHealthSample(sample({ reportedStatus: null }), false).result.status).toBe('ok');
  });

  it('negative: unreachable → warn, fail under --strict', () => {
    const down = sample({
      reachable: false,
      httpStatus: null,
      latencyMs: null,
      reportedStatus: null,
    });
    expect(evaluateHealthSample(down, false).result.status).toBe('warn');
    expect(evaluateHealthSample(down, true).result.status).toBe('fail');
  });

  it('negative: 503 / unhealthy body → warn, fail under --strict', () => {
    const bad = sample({ httpStatus: 503, reportedStatus: 'degraded' });
    expect(evaluateHealthSample(bad, false).result.status).toBe('warn');
    expect(evaluateHealthSample(bad, true).result.status).toBe('fail');
  });
});
