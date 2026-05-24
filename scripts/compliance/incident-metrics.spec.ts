import { describe, expect, it } from 'vitest';
import { type IncidentIssue, analyzeIncidents, hasPostMortem } from './incident-metrics';

const issue = (over: Partial<IncidentIssue>): IncidentIssue => ({
  number: 1,
  title: 'DB outage',
  createdAt: '2026-05-01T00:00:00.000Z',
  closedAt: '2026-05-01T02:00:00.000Z',
  labels: ['incident', 'post-mortem'],
  ...over,
});

describe('hasPostMortem', () => {
  it('matches post-mortem label variants', () => {
    expect(hasPostMortem(['post-mortem'])).toBe(true);
    expect(hasPostMortem(['postmortem'])).toBe(true);
    expect(hasPostMortem(['post_mortem'])).toBe(true);
    expect(hasPostMortem(['incident', 'sev1'])).toBe(false);
  });
});

describe('analyzeIncidents', () => {
  it('positive: resolved incidents with post-mortems → ok with MTTR', () => {
    const issues = [issue({ number: 1 }), issue({ number: 2 })];
    const { result, metrics } = analyzeIncidents(issues, 365, false);
    expect(result.status).toBe('ok');
    expect(metrics.resolved).toBe(2);
    expect(metrics.mttrHours).toBe(2);
    expect(metrics.postMortemRate).toBe(1);
  });

  it('negative: low post-mortem completion → warn, fail under --strict', () => {
    const issues = [
      issue({ number: 1, labels: ['incident', 'post-mortem'] }),
      issue({ number: 2, labels: ['incident'] }),
      issue({ number: 3, labels: ['incident'] }),
    ];
    expect(analyzeIncidents(issues, 365, false).result.status).toBe('warn');
    expect(analyzeIncidents(issues, 365, true).result.status).toBe('fail');
  });

  it('counts open incidents and excludes them from MTTR', () => {
    const issues = [issue({ number: 1 }), issue({ number: 2, closedAt: null })];
    const { metrics } = analyzeIncidents(issues, 365, false);
    expect(metrics.open).toBe(1);
    expect(metrics.resolved).toBe(1);
    expect(metrics.mttrHours).toBe(2);
  });

  it('missing-data: no incidents → ok (healthy), no NaN', () => {
    const { result, metrics } = analyzeIncidents([], 365, false);
    expect(result.status).toBe('ok');
    expect(metrics.total).toBe(0);
    expect(metrics.mttrHours).toBeNull();
    expect(metrics.postMortemRate).toBe(1);
  });
});
