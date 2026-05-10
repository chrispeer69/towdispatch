import { describe, expect, it } from 'vitest';
import { LocalDiskStorageProvider, StorageAccessDenied } from '../storage/local-disk.storage.js';
import { DvirsService } from './dvirs.service.js';
import { ExpirationsService } from './expirations.service.js';
import { MaintenanceService } from './maintenance.service.js';

describe('DvirsService.rollupStatus', () => {
  it('empty defects → no_defects', () => {
    expect(DvirsService.rollupStatus([])).toBe('no_defects');
  });
  it('only minor → minor', () => {
    expect(
      DvirsService.rollupStatus([
        { component: 'Wiper', severity: 'minor' },
        { component: 'Mud flap', severity: 'major' },
      ]),
    ).toBe('minor');
  });
  it('any out_of_service → out_of_service', () => {
    expect(
      DvirsService.rollupStatus([
        { component: 'Brakes', severity: 'out_of_service' },
        { component: 'Wiper', severity: 'minor' },
      ]),
    ).toBe('out_of_service');
  });
});

describe('MaintenanceService.computeNextDue', () => {
  it('mileage schedule advances next_due_miles by interval', () => {
    const out = MaintenanceService.computeNextDue(
      { scheduleType: 'mileage', intervalMiles: 5000, intervalDays: null },
      null,
      50000,
    );
    expect(out.nextDueMiles).toBe(55000);
    expect(out.nextDueAt).toBeNull();
  });
  it('time schedule advances next_due_at by interval days', () => {
    const lastAt = new Date('2026-01-01T00:00:00Z');
    const out = MaintenanceService.computeNextDue(
      { scheduleType: 'time', intervalMiles: null, intervalDays: 90 },
      lastAt,
      null,
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(out.nextDueAt).toBe('2026-04-01');
  });
  it('both: schedules both miles and days', () => {
    const lastAt = new Date('2026-03-01T00:00:00Z');
    const out = MaintenanceService.computeNextDue(
      { scheduleType: 'both', intervalMiles: 7500, intervalDays: 180 },
      lastAt,
      30000,
      new Date('2026-03-15T00:00:00Z'),
    );
    expect(out.nextDueMiles).toBe(37500);
    expect(out.nextDueAt).toBe('2026-08-28');
  });
});

describe('ExpirationsService.bucketize', () => {
  it('past today → expired', () => {
    expect(ExpirationsService.bucketize(0, 30)).toBe('expired');
    expect(ExpirationsService.bucketize(-3, 30)).toBe('expired');
  });
  it('1..7 → critical', () => {
    expect(ExpirationsService.bucketize(1, 30)).toBe('critical');
    expect(ExpirationsService.bucketize(7, 30)).toBe('critical');
  });
  it('8..windowDays → warning', () => {
    expect(ExpirationsService.bucketize(8, 30)).toBe('warning');
    expect(ExpirationsService.bucketize(30, 30)).toBe('warning');
  });
  it('past window → null', () => {
    expect(ExpirationsService.bucketize(31, 30)).toBeNull();
  });
});

describe('LocalDiskStorageProvider — tenant isolation', () => {
  const tenantA = '00000000-0000-7000-8000-000000000001';
  const tenantB = '00000000-0000-7000-8000-000000000002';

  it('rejects a key without the tenant prefix', async () => {
    const sp = new LocalDiskStorageProvider('/tmp/test-storage-root');
    await expect(sp.get(tenantA, 'wrong/path/file.bin')).rejects.toThrow(StorageAccessDenied);
  });

  it('rejects cross-tenant key access', async () => {
    const sp = new LocalDiskStorageProvider('/tmp/test-storage-root');
    const otherKey = `tenants/${tenantB}/truck/abc/file.bin`;
    await expect(sp.get(tenantA, otherKey)).rejects.toThrow(StorageAccessDenied);
  });

  it('rejects path traversal escapes', async () => {
    const sp = new LocalDiskStorageProvider('/tmp/test-storage-root');
    const evil = `tenants/${tenantA}/../${tenantB}/truck/abc/file.bin`;
    await expect(sp.get(tenantA, evil)).rejects.toThrow(StorageAccessDenied);
  });

  it('accepts a properly tenant-scoped key', async () => {
    const sp = new LocalDiskStorageProvider('/tmp/test-storage-root');
    // We call put with a real buffer to verify the round-trip key prefix.
    const key = (
      await sp.put({
        tenantId: tenantA,
        ownerType: 'truck',
        ownerId: '00000000-0000-7000-8000-aaaaaaaaaaaa',
        fileName: 'r.txt',
        mimeType: 'text/plain',
        bytes: Buffer.from('hi'),
      })
    ).key;
    expect(key.startsWith(`tenants/${tenantA}/`)).toBe(true);
    const bytes = await sp.get(tenantA, key);
    expect(bytes.toString()).toBe('hi');
    await sp.delete(tenantA, key);
  });
});
