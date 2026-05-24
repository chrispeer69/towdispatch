/**
 * Unit tests for the audit-anomaly classifier (Session 40). Pure logic, no DB.
 */
import { describe, expect, it } from 'vitest';
import { type AdminAuditRow, classifyAuditAnomalies, isOffHours } from './audit-anomalies.js';

describe('isOffHours', () => {
  it('wraps midnight when start > end (22:00–06:00)', () => {
    const band = { startUtc: 22, endUtc: 6 };
    expect(isOffHours(23, band)).toBe(true);
    expect(isOffHours(2, band)).toBe(true);
    expect(isOffHours(22, band)).toBe(true); // inclusive start
    expect(isOffHours(6, band)).toBe(false); // exclusive end
    expect(isOffHours(12, band)).toBe(false);
  });

  it('is a plain interval when start < end (09:00–17:00)', () => {
    const band = { startUtc: 9, endUtc: 17 };
    expect(isOffHours(12, band)).toBe(true);
    expect(isOffHours(8, band)).toBe(false);
    expect(isOffHours(17, band)).toBe(false);
  });

  it('start === end is an empty band (nothing flagged)', () => {
    expect(isOffHours(3, { startUtc: 0, endUtc: 0 })).toBe(false);
  });
});

const row = (over: Partial<AdminAuditRow>): AdminAuditRow => ({
  id: 'a1',
  actorId: 'u1',
  actorEmail: 'admin@acme.test',
  actorRole: 'admin',
  action: 'UPDATE',
  resourceType: 'jobs',
  resourceId: 'j1',
  createdAt: new Date('2026-05-24T12:00:00.000Z'), // mid-day
  ...over,
});

describe('classifyAuditAnomalies', () => {
  const band = { startUtc: 22, endUtc: 6 };

  it('splits deletes and off-hours activity (and a delete can be both)', () => {
    const rows = [
      row({ id: 'd1', action: 'DELETE' }), // delete, business hours
      row({ id: 'o1', createdAt: new Date('2026-05-24T23:30:00.000Z') }), // off-hours update
      row({ id: 'n1' }), // business-hours update → neither
      row({ id: 'b1', action: 'DELETE', createdAt: new Date('2026-05-24T02:00:00.000Z') }), // both
    ];
    const { adminDeletes, offHoursAdminActivity } = classifyAuditAnomalies(rows, band);

    expect(adminDeletes.map((d) => d.id).sort()).toEqual(['b1', 'd1']);
    expect(offHoursAdminActivity.map((o) => o.id).sort()).toEqual(['b1', 'o1']);
    expect(offHoursAdminActivity.find((o) => o.id === 'o1')?.hourUtc).toBe(23);
  });

  it('serializes createdAt to ISO and preserves actor identity', () => {
    const { adminDeletes } = classifyAuditAnomalies([row({ action: 'DELETE' })], band);
    expect(adminDeletes[0]?.createdAt).toBe('2026-05-24T12:00:00.000Z');
    expect(adminDeletes[0]?.actorEmail).toBe('admin@acme.test');
  });

  it('missing-data: empty rows → empty signals', () => {
    expect(classifyAuditAnomalies([], band)).toEqual({
      adminDeletes: [],
      offHoursAdminActivity: [],
    });
  });
});
