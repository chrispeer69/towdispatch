import { describe, expect, it } from 'vitest';
import { decodeOffset, encodeOffset } from './cursor.js';

describe('cursor', () => {
  it('round-trips offsets', () => {
    for (const n of [0, 1, 50, 17_000]) {
      expect(decodeOffset(encodeOffset(n))).toBe(n);
    }
  });
  it('returns 0 for malformed cursors', () => {
    expect(decodeOffset(undefined)).toBe(0);
    expect(decodeOffset('!!!')).toBe(0);
    expect(decodeOffset(Buffer.from('garbage', 'utf8').toString('base64url'))).toBe(0);
  });
});
