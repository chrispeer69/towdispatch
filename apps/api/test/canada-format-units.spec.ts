/**
 * Canada Expansion (Session 47) — unit conversion + presentation formatting.
 */
import {
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  formatDate,
  formatDateTime,
  formatDistance,
  formatMoney,
  kmToMiles,
  milesToKm,
} from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';

describe('unit conversion (canonical storage unchanged)', () => {
  it('miles ↔ km round-trip', () => {
    expect(milesToKm(100)).toBeCloseTo(160.9344, 4);
    expect(kmToMiles(160.9344)).toBeCloseTo(100, 6);
  });

  it('celsius ↔ fahrenheit', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
  });
});

describe('formatMoney (cents in, currency presentation)', () => {
  it('formats USD for en-US exactly', () => {
    expect(formatMoney(225_000, 'USD', 'en-US')).toBe('$2,250.00');
  });

  it('formats CAD for en-CA', () => {
    const out = formatMoney(225_000, 'CAD', 'en-CA');
    expect(out).toContain('$');
    expect(out).toContain('2,250.00');
  });

  it('formats CAD for fr-CA with comma decimal', () => {
    const out = formatMoney(225_000, 'CAD', 'fr-CA');
    expect(out).toContain('250,00');
    expect(out).toContain('$');
  });
});

describe('formatDistance (canonical miles → tenant unit)', () => {
  it('imperial keeps miles', () => {
    const out = formatDistance(12.5, 'imperial', 'en-US');
    expect(out).toContain('12.5');
    expect(out).toMatch(/mi/);
  });

  it('metric converts to kilometers', () => {
    const out = formatDistance(10, 'metric', 'en-CA');
    expect(out).toMatch(/km/);
    expect(out).toContain('16.1');
  });
});

describe('formatDate / formatDateTime (exact per-locale pattern, UTC)', () => {
  const afternoon = new Date('2026-05-24T14:05:00Z');
  const midnight = new Date('2026-01-01T00:00:00Z');

  it('en-US: M/D/YYYY h:mm AM/PM', () => {
    expect(formatDate(afternoon, 'en-US')).toBe('5/24/2026');
    expect(formatDateTime(afternoon, 'en-US')).toBe('5/24/2026 2:05 PM');
    expect(formatDateTime(midnight, 'en-US')).toBe('1/1/2026 12:00 AM');
  });

  it('en-CA: YYYY-MM-DD HH:mm (24h)', () => {
    expect(formatDate(afternoon, 'en-CA')).toBe('2026-05-24');
    expect(formatDateTime(afternoon, 'en-CA')).toBe('2026-05-24 14:05');
  });

  it('fr-CA: AAAA-MM-JJ HH:mm (24h numeric)', () => {
    expect(formatDate(afternoon, 'fr-CA')).toBe('2026-05-24');
    expect(formatDateTime(afternoon, 'fr-CA')).toBe('2026-05-24 14:05');
    expect(formatDateTime(midnight, 'fr-CA')).toBe('2026-01-01 00:00');
  });
});
