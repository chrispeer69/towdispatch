/**
 * Unit tests for the PreferencesResolver quiet-hours math and the
 * channel-set merge logic. The DB-backed paths are exercised by the
 * integration tests; these tests stub the tx so they run in-process.
 */
import { describe, expect, it } from 'vitest';
import { PreferencesResolverService } from './preferences-resolver.service.js';

describe('PreferencesResolverService.isInQuietHours', () => {
  const svc = new PreferencesResolverService();

  it('returns false when no quiet-hours row', () => {
    expect(svc.isInQuietHours(null, new Date('2026-05-10T02:00:00Z'))).toBe(false);
  });

  it('returns false when row exists but disabled', () => {
    const qh = {
      enabled: false,
      startLocal: '22:00',
      endLocal: '07:00',
      timezone: 'UTC',
      overrideEventTypes: [],
    };
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T02:00:00Z'))).toBe(false);
  });

  it('treats a same-day window correctly', () => {
    const qh = {
      enabled: true,
      startLocal: '09:00',
      endLocal: '17:00',
      timezone: 'UTC',
      overrideEventTypes: [],
    };
    // 10:00 UTC → inside
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T10:00:00Z'))).toBe(true);
    // 18:00 UTC → outside
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T18:00:00Z'))).toBe(false);
  });

  it('treats a wrap-midnight window correctly', () => {
    const qh = {
      enabled: true,
      startLocal: '22:00',
      endLocal: '07:00',
      timezone: 'UTC',
      overrideEventTypes: [],
    };
    // 23:30 → inside
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T23:30:00Z'))).toBe(true);
    // 06:30 → inside (next morning)
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T06:30:00Z'))).toBe(true);
    // 12:00 → outside
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T12:00:00Z'))).toBe(false);
  });

  it('honors a non-UTC timezone', () => {
    const qh = {
      enabled: true,
      startLocal: '22:00',
      endLocal: '07:00',
      timezone: 'America/New_York',
      overrideEventTypes: [],
    };
    // 03:00 UTC = 23:00 EDT → inside
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T03:00:00Z'))).toBe(true);
    // 13:00 UTC = 09:00 EDT → outside
    expect(svc.isInQuietHours(qh, new Date('2026-05-10T13:00:00Z'))).toBe(false);
  });
});

describe('PreferencesResolverService.nextQuietHoursEnd', () => {
  const svc = new PreferencesResolverService();

  it('returns a future date inside the same window', () => {
    const qh = {
      enabled: true,
      startLocal: '22:00',
      endLocal: '07:00',
      timezone: 'UTC',
      overrideEventTypes: [],
    };
    const now = new Date('2026-05-10T23:00:00Z'); // 1h after start
    const end = svc.nextQuietHoursEnd(qh, now);
    // Should be 8h later (until 07:00 next day)
    expect(end.getTime() - now.getTime()).toBeGreaterThanOrEqual(7 * 3600 * 1000);
    expect(end.getTime() - now.getTime()).toBeLessThanOrEqual(9 * 3600 * 1000);
  });

  it('returns soon if we are already close to endLocal', () => {
    const qh = {
      enabled: true,
      startLocal: '22:00',
      endLocal: '07:00',
      timezone: 'UTC',
      overrideEventTypes: [],
    };
    const now = new Date('2026-05-11T06:30:00Z');
    const end = svc.nextQuietHoursEnd(qh, now);
    expect(end.getTime() - now.getTime()).toBeLessThanOrEqual(45 * 60 * 1000);
  });
});
