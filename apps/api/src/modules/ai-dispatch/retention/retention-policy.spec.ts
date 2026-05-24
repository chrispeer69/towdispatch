/**
 * Unit spec — pure retention policy (retention-policy.ts). No DB.
 * Pins the cutoff math and the row classifier boundaries that the
 * RetentionService SQL implements.
 */
import { describe, expect, it } from 'vitest';
import {
  RETENTION_POLICIES,
  RETENTION_TABLES,
  type RetentionPolicy,
  classifyRow,
  retentionCutoffs,
} from './retention-policy.js';

const MS_PER_DAY = 86_400_000;
const now = new Date('2026-05-24T03:00:00Z');

describe('RETENTION_POLICIES', () => {
  it('covers exactly the three high-volume tables', () => {
    expect([...RETENTION_TABLES].sort()).toEqual([
      'dispatch_outcomes',
      'dispatch_recommendations',
      'eta_predictions',
    ]);
  });

  it('hard window is always strictly longer than the soft window', () => {
    for (const p of Object.values(RETENTION_POLICIES)) {
      expect(p.hardDeleteDays).toBeGreaterThan(p.softDeleteDays);
    }
  });

  it('holds the agreed per-table windows', () => {
    expect(RETENTION_POLICIES.dispatch_recommendations).toMatchObject({
      softDeleteDays: 30,
      hardDeleteDays: 60,
    });
    expect(RETENTION_POLICIES.dispatch_outcomes).toMatchObject({
      softDeleteDays: 365,
      hardDeleteDays: 730,
    });
    expect(RETENTION_POLICIES.eta_predictions).toMatchObject({
      softDeleteDays: 90,
      hardDeleteDays: 180,
    });
  });
});

describe('retentionCutoffs', () => {
  it('places cutoffs softDeleteDays / hardDeleteDays before now', () => {
    const policy = RETENTION_POLICIES.dispatch_recommendations;
    const { softCutoff, hardCutoff } = retentionCutoffs(policy, now);
    expect(softCutoff.getTime()).toBe(now.getTime() - 30 * MS_PER_DAY);
    expect(hardCutoff.getTime()).toBe(now.getTime() - 60 * MS_PER_DAY);
  });
});

describe('classifyRow', () => {
  const policy: RetentionPolicy = RETENTION_POLICIES.dispatch_recommendations; // 30 / 60
  const cutoffs = retentionCutoffs(policy, now);
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * MS_PER_DAY);

  it('keeps a fresh live row', () => {
    expect(classifyRow({ createdAt: at(1), deletedAt: null }, cutoffs)).toBe('keep');
  });

  it('keeps a live row exactly at the soft cutoff (strict <)', () => {
    expect(classifyRow({ createdAt: at(30), deletedAt: null }, cutoffs)).toBe('keep');
  });

  it('soft-deletes a live row just past the soft cutoff', () => {
    expect(classifyRow({ createdAt: at(31), deletedAt: null }, cutoffs)).toBe('soft_delete');
  });

  it('still only soft-deletes a live row past the HARD age (purge waits for next run)', () => {
    expect(classifyRow({ createdAt: at(90), deletedAt: null }, cutoffs)).toBe('soft_delete');
  });

  it('keeps a soft-deleted row younger than the hard cutoff', () => {
    expect(classifyRow({ createdAt: at(45), deletedAt: at(15) }, cutoffs)).toBe('keep');
  });

  it('keeps a soft-deleted row exactly at the hard cutoff (strict <)', () => {
    expect(classifyRow({ createdAt: at(60), deletedAt: at(30) }, cutoffs)).toBe('keep');
  });

  it('hard-deletes a soft-deleted row past the hard cutoff', () => {
    expect(classifyRow({ createdAt: at(61), deletedAt: at(31) }, cutoffs)).toBe('hard_delete');
  });
});
