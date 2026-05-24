/**
 * Canada Expansion (Session 47) — postal-code validation.
 */
import {
  formatPostalCode,
  isValidCaPostal,
  isValidPostalCode,
  isValidUsZip,
  postalCodeSchema,
} from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';

describe('US ZIP validation', () => {
  it('accepts 5-digit and ZIP+4', () => {
    expect(isValidUsZip('80918')).toBe(true);
    expect(isValidUsZip('80918-1234')).toBe(true);
    expect(isValidUsZip(' 80918 ')).toBe(true);
  });

  it('rejects malformed ZIPs', () => {
    expect(isValidUsZip('8091')).toBe(false);
    expect(isValidUsZip('809188')).toBe(false);
    expect(isValidUsZip('K1A 0B1')).toBe(false);
    expect(isValidUsZip('80918-12')).toBe(false);
  });
});

describe('Canadian postal validation', () => {
  it('accepts valid postal codes with or without the space, any case', () => {
    expect(isValidCaPostal('K1A 0B1')).toBe(true);
    expect(isValidCaPostal('K1A0B1')).toBe(true);
    expect(isValidCaPostal('k1a 0b1')).toBe(true);
    expect(isValidCaPostal('A1A 1A1')).toBe(true);
    expect(isValidCaPostal('V6Z 1L9')).toBe(true);
    expect(isValidCaPostal('A1A 0Z1')).toBe(true); // Z is legal in interior positions
  });

  it('rejects the excluded letters D, F, I, O, Q, U (and W, Z leading)', () => {
    expect(isValidCaPostal('D1A 0B1')).toBe(false); // D cannot lead
    expect(isValidCaPostal('W1A 0B1')).toBe(false); // W cannot lead
    expect(isValidCaPostal('Z1A 0B1')).toBe(false); // Z cannot lead
    expect(isValidCaPostal('A1F 0B1')).toBe(false); // F excluded interior
    expect(isValidCaPostal('A1A 0O1')).toBe(false); // O excluded interior
    expect(isValidCaPostal('A1A 0U1')).toBe(false); // U excluded interior
  });

  it('rejects wrong lengths and non-postal strings', () => {
    expect(isValidCaPostal('A1A 0B')).toBe(false);
    expect(isValidCaPostal('A1A 0B12')).toBe(false);
    expect(isValidCaPostal('123 456')).toBe(false);
    expect(isValidCaPostal('')).toBe(false);
  });
});

describe('country-aware dispatch + formatting', () => {
  it('routes by country code', () => {
    expect(isValidPostalCode('80918', 'US')).toBe(true);
    expect(isValidPostalCode('K1A 0B1', 'CA')).toBe(true);
    expect(isValidPostalCode('K1A 0B1', 'US')).toBe(false);
    expect(isValidPostalCode('80918', 'CA')).toBe(false);
  });

  it('is permissive for unmodeled countries but rejects empty', () => {
    expect(isValidPostalCode('SW1A 1AA', 'GB')).toBe(true);
    expect(isValidPostalCode('', 'GB')).toBe(false);
  });

  it('normalizes Canadian display form to uppercase with a single space', () => {
    expect(formatPostalCode('k1a0b1', 'CA')).toBe('K1A 0B1');
    expect(formatPostalCode('K1A   0B1', 'CA')).toBe('K1A 0B1');
    expect(formatPostalCode('80918', 'US')).toBe('80918');
  });

  it('exposes a country-aware Zod schema', () => {
    expect(postalCodeSchema('CA').safeParse('K1A 0B1').success).toBe(true);
    expect(postalCodeSchema('CA').safeParse('D1A 0B1').success).toBe(false);
    expect(postalCodeSchema('US').safeParse('80918-1234').success).toBe(true);
  });
});
