import { describe, expect, it } from 'vitest';
import { analyzeAudit, parseAuditCounts } from './dependency-scan';

describe('parseAuditCounts', () => {
  it('reads metadata.vulnerabilities and defaults missing buckets to 0', () => {
    const counts = parseAuditCounts({ metadata: { vulnerabilities: { critical: 1, high: 2 } } });
    expect(counts).toEqual({ critical: 1, high: 2, moderate: 0, low: 0, info: 0 });
  });

  it('missing-data: unparseable/empty shape → all zeros', () => {
    expect(parseAuditCounts({})).toEqual({ critical: 0, high: 0, moderate: 0, low: 0, info: 0 });
    expect(parseAuditCounts(null)).toEqual({ critical: 0, high: 0, moderate: 0, low: 0, info: 0 });
  });
});

describe('analyzeAudit', () => {
  it('positive: clean tree → ok', () => {
    const r = analyzeAudit({ critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, false);
    expect(r.result.status).toBe('ok');
  });

  it('moderate-only → warn (regardless of strict)', () => {
    expect(
      analyzeAudit({ critical: 0, high: 0, moderate: 3, low: 0, info: 0 }, false).result.status,
    ).toBe('warn');
    expect(
      analyzeAudit({ critical: 0, high: 0, moderate: 3, low: 0, info: 0 }, true).result.status,
    ).toBe('warn');
  });

  it('negative: critical/high → warn, fail under --strict', () => {
    const counts = { critical: 1, high: 0, moderate: 0, low: 0, info: 0 };
    expect(analyzeAudit(counts, false).result.status).toBe('warn');
    expect(analyzeAudit(counts, true).result.status).toBe('fail');
  });
});
