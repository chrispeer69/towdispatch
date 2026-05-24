/**
 * Pure unit tests for the marketplace token + PKCE primitives and the scope
 * containment helpers. No DB, no Nest — these always run in CI.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  formatScopeString,
  parseScopeString,
  scopesContained,
  unknownScopes,
} from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  generateOpaqueToken,
  hashSecret,
  parseDurationSeconds,
  signWebhookBody,
  verifyPkceS256,
  verifySecretHash,
} from './marketplace-tokens.util.js';

describe('marketplace token primitives', () => {
  it('generateOpaqueToken carries its prefix and is high-entropy', () => {
    const a = generateOpaqueToken('usto_at_');
    const b = generateOpaqueToken('usto_at_');
    expect(a.startsWith('usto_at_')).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
  });

  it('verifySecretHash accepts the matching plaintext and rejects others', () => {
    const secret = generateOpaqueToken('usto_cs_');
    const stored = hashSecret(secret);
    expect(verifySecretHash(secret, stored)).toBe(true);
    expect(verifySecretHash(`${secret}x`, stored)).toBe(false);
    expect(verifySecretHash(secret, hashSecret('other'))).toBe(false);
  });

  it('verifySecretHash is total on malformed stored hashes', () => {
    expect(verifySecretHash('whatever', 'not-the-right-length')).toBe(false);
  });
});

describe('PKCE S256 verification', () => {
  const makeChallenge = (verifier: string): string =>
    createHash('sha256').update(verifier).digest('base64url');

  it('accepts a correct verifier/challenge pair', () => {
    const verifier = randomBytes(48).toString('base64url'); // 64 chars, in range
    const challenge = makeChallenge(verifier);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    const challenge = makeChallenge(randomBytes(48).toString('base64url'));
    const wrong = randomBytes(48).toString('base64url');
    expect(verifyPkceS256(wrong, challenge)).toBe(false);
  });

  it('rejects an out-of-range verifier (RFC 7636 §4.1)', () => {
    const verifier = 'too-short';
    expect(verifyPkceS256(verifier, makeChallenge(verifier))).toBe(false);
  });

  it('never throws on garbage input', () => {
    expect(verifyPkceS256('', '')).toBe(false);
    // @ts-expect-error — deliberately wrong types
    expect(verifyPkceS256(null, undefined)).toBe(false);
  });
});

describe('parseDurationSeconds', () => {
  it.each([
    ['15m', 900],
    ['1h', 3600],
    ['30d', 2_592_000],
    ['45s', 45],
    ['120', 120],
  ])('%s -> %d seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });
});

describe('webhook signing', () => {
  it('is deterministic and key-sensitive', () => {
    const body = JSON.stringify({ event: 'install', appId: 'x' });
    const s1 = signWebhookBody('secret-a', body);
    const s2 = signWebhookBody('secret-a', body);
    const s3 = signWebhookBody('secret-b', body);
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('scope containment helpers', () => {
  it('unknownScopes flags non-catalog scopes', () => {
    expect(unknownScopes(['read:jobs', 'write:jobs'])).toEqual([]);
    expect(unknownScopes(['read:jobs', 'delete:everything'])).toEqual(['delete:everything']);
  });

  it('scopesContained enforces subset semantics', () => {
    expect(scopesContained(['read:jobs'], ['read:jobs', 'write:jobs'])).toBe(true);
    expect(scopesContained(['write:invoices'], ['read:jobs'])).toBe(false);
    expect(scopesContained([], ['read:jobs'])).toBe(true);
  });

  it('parse/format round-trips and de-duplicates', () => {
    expect(parseScopeString('read:jobs  write:jobs read:jobs')).toEqual([
      'read:jobs',
      'write:jobs',
    ]);
    expect(parseScopeString(null)).toEqual([]);
    expect(formatScopeString(['read:jobs', 'write:jobs'])).toBe('read:jobs write:jobs');
  });
});
