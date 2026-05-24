import { describe, expect, it } from 'vitest';
import {
  LOOKUP_RATE_LIMIT,
  LOOKUP_RATE_WINDOW_SECONDS,
  MAGIC_LINK_RATE_LIMIT,
  MAGIC_LINK_RATE_WINDOW_SECONDS,
  lookupRateKey,
  magicLinkRateKey,
  normalizeIp,
} from './rate-limit-policy.js';

describe('rate-limit policy', () => {
  it('encodes the documented limits (5/15min lookups, 3/hr magic links)', () => {
    expect(LOOKUP_RATE_LIMIT).toBe(5);
    expect(LOOKUP_RATE_WINDOW_SECONDS).toBe(900);
    expect(MAGIC_LINK_RATE_LIMIT).toBe(3);
    expect(MAGIC_LINK_RATE_WINDOW_SECONDS).toBe(3600);
  });

  it('normalizes IPv4-mapped IPv6 to the bare IPv4 (same bucket)', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('maps empty/null IP to a single "unknown" bucket', () => {
    expect(normalizeIp(null)).toBe('unknown');
    expect(normalizeIp('   ')).toBe('unknown');
  });

  it('lookup key is per tenant + IP', () => {
    expect(lookupRateKey('t1', '203.0.113.7')).toBe('ssp:lookup:t1:203.0.113.7');
    expect(lookupRateKey('t1', '::ffff:203.0.113.7')).toBe(lookupRateKey('t1', '203.0.113.7'));
    expect(lookupRateKey('t1', '1.1.1.1')).not.toBe(lookupRateKey('t2', '1.1.1.1'));
  });

  it('magic-link key is per tenant + impound', () => {
    expect(magicLinkRateKey('t1', 'imp-9')).toBe('ssp:maglink:t1:imp-9');
    expect(magicLinkRateKey('t1', 'imp-9')).not.toBe(magicLinkRateKey('t1', 'imp-8'));
  });
});
