import { describe, expect, it } from 'vitest';
import { type MergedPr, analyzeChangeManagement, isRevert } from './change-management';

const pr = (over: Partial<MergedPr>): MergedPr => ({
  number: 1,
  title: 'feat: thing',
  createdAt: '2026-05-01T00:00:00.000Z',
  mergedAt: '2026-05-01T04:00:00.000Z',
  reviewDecision: 'APPROVED',
  ...over,
});

describe('isRevert', () => {
  it('detects revert PRs and ignores normal titles', () => {
    expect(isRevert('Revert "feat: x"')).toBe(true);
    expect(isRevert('revert: bad deploy')).toBe(true);
    expect(isRevert('feat: add revert button')).toBe(false);
    expect(isRevert('Refactor revert handling')).toBe(false);
  });
});

describe('analyzeChangeManagement', () => {
  it('positive: full review coverage → ok with metrics', () => {
    const prs = Array.from({ length: 5 }, (_, i) => pr({ number: i }));
    const { result, metrics } = analyzeChangeManagement(prs, 90, false);
    expect(result.status).toBe('ok');
    expect(metrics.mergedCount).toBe(5);
    expect(metrics.reviewCoverage).toBe(1);
    expect(metrics.meanTimeToMergeHours).toBe(4);
    expect(metrics.rollbackRate).toBe(0);
  });

  it('negative: low review coverage → warn, and fail under --strict', () => {
    const prs = [
      pr({ number: 1, reviewDecision: 'APPROVED' }),
      pr({ number: 2, reviewDecision: null }),
      pr({ number: 3, reviewDecision: 'REVIEW_REQUIRED' }),
    ];
    expect(analyzeChangeManagement(prs, 90, false).result.status).toBe('warn');
    expect(analyzeChangeManagement(prs, 90, true).result.status).toBe('fail');
  });

  it('counts reverts toward rollback rate', () => {
    const prs = [pr({ number: 1 }), pr({ number: 2, title: 'Revert "feat: x"' })];
    const { metrics } = analyzeChangeManagement(prs, 90, false);
    expect(metrics.rollbackCount).toBe(1);
    expect(metrics.rollbackRate).toBe(0.5);
  });

  it('missing-data: no merged PRs → warn, no NaN metrics', () => {
    const { result, metrics } = analyzeChangeManagement([], 30, false);
    expect(result.status).toBe('warn');
    expect(metrics.mergedCount).toBe(0);
    expect(metrics.meanTimeToMergeHours).toBeNull();
    expect(metrics.reviewCoverage).toBe(1); // vacuously, not NaN
  });
});
