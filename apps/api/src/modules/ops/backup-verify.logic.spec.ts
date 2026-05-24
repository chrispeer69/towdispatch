import { describe, expect, it } from 'vitest';
import { assessBackupFreshness } from './backup-verify.logic.js';

const NOW = new Date('2026-05-24T12:00:00.000Z');

describe('assessBackupFreshness', () => {
  it('passes when the backup is well within the threshold', () => {
    const twoHoursAgo = new Date('2026-05-24T10:00:00.000Z');
    const r = assessBackupFreshness(twoHoursAgo, NOW, 24);
    expect(r.ok).toBe(true);
    expect(r.ageHours).toBe(2);
  });

  it('fails when the backup is older than the threshold', () => {
    const thirtyHoursAgo = new Date('2026-05-23T06:00:00.000Z');
    const r = assessBackupFreshness(thirtyHoursAgo, NOW, 24);
    expect(r.ok).toBe(false);
    expect(r.ageHours).toBe(30);
    expect(r.reason).toContain('exceeding the 24h threshold');
  });

  it('passes exactly at the threshold boundary', () => {
    const exactly24h = new Date('2026-05-23T12:00:00.000Z');
    const r = assessBackupFreshness(exactly24h, NOW, 24);
    expect(r.ok).toBe(true);
    expect(r.ageHours).toBe(24);
  });

  it('treats null metadata as a failed verification (not a silent pass)', () => {
    const r = assessBackupFreshness(null, NOW, 24);
    expect(r.ok).toBe(false);
    expect(r.ageHours).toBe(null);
    expect(r.reason).toContain('No backup metadata available');
  });

  it('fails on a future backup timestamp (clock skew / bad data)', () => {
    const future = new Date('2026-05-24T18:00:00.000Z');
    const r = assessBackupFreshness(future, NOW, 24);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('future');
  });
});
