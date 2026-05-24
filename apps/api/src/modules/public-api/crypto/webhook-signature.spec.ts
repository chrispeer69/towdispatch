import { describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  verifySignature,
} from './webhook-signature.js';

const SECRET = 'whsec_test_0123456789abcdef';
const BODY = JSON.stringify({ id: 'd1', type: 'job.created', data: { x: 1 } });

describe('webhook-signature', () => {
  it('computeSignature is deterministic and depends on secret, body, and timestamp', () => {
    const ts = 1_700_000_000;
    const sig = computeSignature(SECRET, BODY, ts);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSignature(SECRET, BODY, ts)).toBe(sig);
    expect(computeSignature('other', BODY, ts)).not.toBe(sig);
    expect(computeSignature(SECRET, '{}', ts)).not.toBe(sig);
    expect(computeSignature(SECRET, BODY, ts + 1)).not.toBe(sig);
  });

  it('buildSignatureHeader / parseSignatureHeader round-trip', () => {
    const ts = 1_700_000_123;
    const header = buildSignatureHeader(SECRET, BODY, ts);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const parsed = parseSignatureHeader(header);
    expect(parsed?.t).toBe(ts);
    expect(parsed?.v1).toBe(computeSignature(SECRET, BODY, ts));
  });

  it('parseSignatureHeader returns null for garbage', () => {
    expect(parseSignatureHeader('')).toBeNull();
    expect(parseSignatureHeader('v1=abc')).toBeNull();
    expect(parseSignatureHeader('t=123')).toBeNull();
  });

  it('verifySignature accepts a fresh, correct signature', () => {
    const now = 1_700_000_000;
    const header = buildSignatureHeader(SECRET, BODY, now);
    expect(verifySignature(SECRET, BODY, header, { nowSec: now })).toBe(true);
  });

  it('verifySignature rejects a wrong secret or tampered body', () => {
    const now = 1_700_000_000;
    const header = buildSignatureHeader(SECRET, BODY, now);
    expect(verifySignature('wrong', BODY, header, { nowSec: now })).toBe(false);
    expect(verifySignature(SECRET, `${BODY} `, header, { nowSec: now })).toBe(false);
  });

  it('verifySignature rejects a stale timestamp outside tolerance', () => {
    const signedAt = 1_700_000_000;
    const header = buildSignatureHeader(SECRET, BODY, signedAt);
    // 10 minutes later, default tolerance 5 min → reject.
    expect(verifySignature(SECRET, BODY, header, { nowSec: signedAt + 600 })).toBe(false);
    // within tolerance → accept.
    expect(verifySignature(SECRET, BODY, header, { nowSec: signedAt + 120 })).toBe(true);
  });
});
