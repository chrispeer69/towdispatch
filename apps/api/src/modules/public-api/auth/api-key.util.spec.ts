import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  parseApiKey,
} from './api-key.util.js';

describe('api-key.util', () => {
  it('generates a tc_live_<prefix>_<secret> key with a matching hash', () => {
    const k = generateApiKey('live');
    expect(k.plaintext).toMatch(/^tc_live_[0-9a-f]{12}_[0-9a-f]{64}$/);
    expect(k.prefix).toMatch(/^[0-9a-f]{12}$/);
    expect(k.hash).toBe(hashApiKey(k.plaintext));
    expect(k.hash).toHaveLength(64); // sha256 hex
  });

  it('generates unique keys + prefixes each call', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.prefix).not.toBe(b.prefix);
  });

  it('supports a test environment prefix', () => {
    expect(generateApiKey('test').plaintext).toMatch(/^tc_test_/);
  });

  it('parseApiKey extracts the prefix from a well-formed key', () => {
    const k = generateApiKey('live');
    const parsed = parseApiKey(k.plaintext);
    expect(parsed).not.toBeNull();
    expect(parsed?.env).toBe('live');
    expect(parsed?.prefix).toBe(k.prefix);
  });

  it('parseApiKey rejects malformed keys', () => {
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('nope')).toBeNull();
    expect(parseApiKey('tc_live_short_xyz')).toBeNull();
    expect(parseApiKey(`tc_prod_abcdef012345_${'a'.repeat(64)}`)).toBeNull();
    // wrong secret length
    expect(parseApiKey(`tc_live_abcdef012345_${'a'.repeat(32)}`)).toBeNull();
  });

  it('bearerToken pulls the token from an Authorization header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer    ')).toBeNull();
  });

  it('hashesEqual is true for equal hex digests, false otherwise', () => {
    const h = hashApiKey('whatever');
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, hashApiKey('different'))).toBe(false);
    expect(hashesEqual(h, h.slice(0, 10))).toBe(false); // length mismatch
  });
});
