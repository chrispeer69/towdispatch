/**
 * Token generation contract:
 *  - 32-char base64url
 *  - URL-safe alphabet
 *  - effectively unique across many calls
 *  - shape validator accepts what we generate and rejects obvious junk
 */
import { describe, expect, it } from 'vitest';
import { generateTrackingToken, isPlausibleToken } from './tracking-token.util.js';

describe('tracking token', () => {
  it('generates 32-char base64url strings', () => {
    for (let i = 0; i < 100; i++) {
      const t = generateTrackingToken();
      expect(t.length).toBe(32);
      expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });

  it('produces unique tokens across 10k draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(generateTrackingToken());
    }
    expect(seen.size).toBe(10_000);
  });

  it('isPlausibleToken accepts our shape and rejects obvious junk', () => {
    expect(isPlausibleToken(generateTrackingToken())).toBe(true);
    expect(isPlausibleToken('short')).toBe(false);
    expect(isPlausibleToken('this/has/slashes/and/is/wrong/long_enough_chars')).toBe(false);
    expect(isPlausibleToken('with spaces in it which are bad bad bad')).toBe(false);
    // Empty
    expect(isPlausibleToken('')).toBe(false);
  });
});
