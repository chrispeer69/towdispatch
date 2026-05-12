import { describe, expect, it } from 'vitest';
import {
  dollarsToCents,
  isValidVin,
  mapValue,
  normalizeEmail,
  normalizePhone,
  normalizeString,
  parseTowbookTimestamp,
} from './normalizers.js';

describe('normalizers', () => {
  describe('normalizePhone', () => {
    it('formats US 10-digit to E.164', () => {
      expect(normalizePhone('(310) 555-1234')).toBe('+13105551234');
      expect(normalizePhone('310-555-1234')).toBe('+13105551234');
      expect(normalizePhone('3105551234')).toBe('+13105551234');
    });
    it('handles 11-digit with country code', () => {
      expect(normalizePhone('13105551234')).toBe('+13105551234');
    });
    it('returns null for blank', () => {
      expect(normalizePhone('')).toBeNull();
      expect(normalizePhone('   ')).toBeNull();
      expect(normalizePhone(null)).toBeNull();
    });
    it('falls back to digits-only for partial numbers', () => {
      const result = normalizePhone('555-1234');
      expect(result).toBe('5551234');
    });
  });

  describe('normalizeEmail', () => {
    it('lowercases and trims', () => {
      expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
    });
    it('returns null for blank', () => {
      expect(normalizeEmail('')).toBeNull();
      expect(normalizeEmail(null)).toBeNull();
    });
  });

  describe('dollarsToCents', () => {
    it('converts dollar strings to integer cents', () => {
      expect(dollarsToCents('12.99')).toBe(1299);
      expect(dollarsToCents('1,299.00')).toBe(129900);
      expect(dollarsToCents('$45.00')).toBe(4500);
    });
    it('handles whole dollars', () => {
      expect(dollarsToCents('12')).toBe(1200);
    });
    it('avoids float drift', () => {
      // 12.99 * 100 in JS is 1298.9999...; Math.round fixes it.
      expect(dollarsToCents('12.99')).toBe(1299);
    });
    it('returns null on malformed input', () => {
      expect(dollarsToCents('not a number')).toBeNull();
      expect(dollarsToCents('')).toBeNull();
      expect(dollarsToCents(null)).toBeNull();
    });
  });

  describe('parseTowbookTimestamp', () => {
    it('parses YYYY-MM-DD HH:MM:SS as America/New_York → UTC', () => {
      // 2024-03-15 14:32:00 ET (EDT = UTC-4) → 2024-03-15T18:32:00Z
      const iso = parseTowbookTimestamp('2024-03-15 14:32:00');
      expect(iso).toBe('2024-03-15T18:32:00.000Z');
    });
    it('handles winter / EST offset', () => {
      // 2024-01-15 14:32:00 ET (EST = UTC-5) → 2024-01-15T19:32:00Z
      const iso = parseTowbookTimestamp('2024-01-15 14:32:00');
      expect(iso).toBe('2024-01-15T19:32:00.000Z');
    });
    it('parses US-style date with AM/PM', () => {
      const iso = parseTowbookTimestamp('3/15/2024 2:32 PM');
      expect(iso).toBe('2024-03-15T18:32:00.000Z');
    });
    it('passes through explicit UTC offsets unchanged', () => {
      expect(parseTowbookTimestamp('2024-03-15T18:32:00Z')).toBe('2024-03-15T18:32:00.000Z');
    });
    it('returns null on garbage', () => {
      expect(parseTowbookTimestamp('not a date')).toBeNull();
      expect(parseTowbookTimestamp('')).toBeNull();
    });
  });

  describe('isValidVin', () => {
    it('accepts known valid VINs', () => {
      expect(isValidVin('1HGBH41JXMN109186')).toBe(true);
    });
    it('rejects wrong check digit', () => {
      expect(isValidVin('1HGBH41JXMN109187')).toBe(false);
    });
    it('rejects forbidden letters', () => {
      expect(isValidVin('1HGBH41JOMN109186')).toBe(false);
    });
    it('rejects wrong length', () => {
      expect(isValidVin('ABC123')).toBe(false);
    });
  });

  describe('mapValue', () => {
    const maps = {
      service: { Tow: 'tow', Lockout: 'lockout' },
    };
    it('returns mapped value', () => {
      expect(mapValue(maps, 'service', 'Tow')).toBe('tow');
    });
    it('returns null when no match', () => {
      expect(mapValue(maps, 'service', 'Unknown')).toBeNull();
    });
    it('returns null for blank input', () => {
      expect(mapValue(maps, 'service', '')).toBeNull();
      expect(mapValue(maps, 'service', null)).toBeNull();
    });
    it('returns input unchanged when category has no map', () => {
      expect(mapValue(maps, 'missing', 'foo')).toBe('foo');
    });
  });

  describe('normalizeString', () => {
    it('trims and returns null for blank', () => {
      expect(normalizeString('  hello  ')).toBe('hello');
      expect(normalizeString('')).toBeNull();
      expect(normalizeString('   ')).toBeNull();
      expect(normalizeString(null)).toBeNull();
    });
  });
});
