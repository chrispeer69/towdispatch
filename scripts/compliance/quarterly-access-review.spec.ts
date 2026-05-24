import { describe, expect, it } from 'vitest';
import {
  type RosterUser,
  analyzeRoster,
  quarterLabel,
  renderReview,
} from './quarterly-access-review';

const NOW = new Date('2026-05-24T00:00:00.000Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const user = (over: Partial<RosterUser>): RosterUser => ({
  tenantName: 'Acme Towing',
  email: 'u@acme.test',
  role: 'dispatcher',
  isActive: true,
  mfaEnabled: true,
  lastLoginAt: daysAgo(1),
  deletedAt: null,
  ...over,
});

describe('analyzeRoster', () => {
  it('positive: clean roster → no flags, role distribution', () => {
    const a = analyzeRoster([user({}), user({ email: 'o@acme.test', role: 'owner' })], NOW);
    expect(a.activeCount).toBe(2);
    expect(a.staleUsers).toHaveLength(0);
    expect(a.privilegedWithoutMfa).toHaveLength(0);
    expect(a.roleDistribution).toEqual({ dispatcher: 1, owner: 1 });
  });

  it('flags stale, never-logged-in, and privileged-without-MFA', () => {
    const a = analyzeRoster(
      [
        user({ email: 'stale@acme.test', lastLoginAt: daysAgo(120) }),
        user({ email: 'new@acme.test', lastLoginAt: null }),
        user({ email: 'admin@acme.test', role: 'admin', mfaEnabled: false }),
      ],
      NOW,
    );
    expect(a.staleUsers.map((u) => u.email)).toEqual(['stale@acme.test']);
    expect(a.neverLoggedIn.map((u) => u.email)).toEqual(['new@acme.test']);
    expect(a.privilegedWithoutMfa.map((u) => u.email)).toEqual(['admin@acme.test']);
  });

  it('excludes soft-deleted and inactive users from active counts', () => {
    const a = analyzeRoster(
      [user({ deletedAt: daysAgo(5) }), user({ isActive: false, lastLoginAt: daysAgo(200) })],
      NOW,
    );
    expect(a.total).toBe(2);
    expect(a.activeCount).toBe(0);
    expect(a.staleUsers).toHaveLength(0);
  });

  it('missing-data: empty roster → zeros, no throw', () => {
    const a = analyzeRoster([], NOW);
    expect(a.total).toBe(0);
    expect(a.activeCount).toBe(0);
    expect(a.roleDistribution).toEqual({});
  });
});

describe('renderReview / quarterLabel', () => {
  it('labels the quarter and renders the required sections', () => {
    expect(quarterLabel(NOW)).toBe('2026-Q2');
    const md = renderReview(analyzeRoster([user({})], NOW), NOW);
    expect(md).toContain('# Access Review — 2026-Q2');
    expect(md).toContain('Privileged accounts without MFA');
    expect(md).toContain('Sign-off date');
  });
});
