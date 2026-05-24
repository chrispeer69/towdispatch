import { describe, expect, it } from 'vitest';
import { signSessionToken, slideSessionToken, verifySessionToken } from './session-token.js';

const SECRET = 'test-self-serve-portal-session-secret-32+chars';
const claims = { sid: 'sess-1', tid: 'tenant-1', iid: 'impound-1' };
const NOW = 1_700_000_000;
const TTL = 3600;

describe('session-token sign/verify', () => {
  it('round-trips a freshly signed token', () => {
    const tok = signSessionToken(claims, SECRET, NOW, TTL);
    const p = verifySessionToken(tok, SECRET, NOW + 10);
    expect(p).not.toBeNull();
    expect(p?.sid).toBe('sess-1');
    expect(p?.tid).toBe('tenant-1');
    expect(p?.iid).toBe('impound-1');
    expect(p?.exp).toBe(NOW + TTL);
  });

  it('rejects an expired token', () => {
    const tok = signSessionToken(claims, SECRET, NOW, TTL);
    expect(verifySessionToken(tok, SECRET, NOW + TTL + 1)).toBeNull();
    // exactly at expiry is also rejected (exp <= now)
    expect(verifySessionToken(tok, SECRET, NOW + TTL)).toBeNull();
  });

  it('rejects a wrong signing secret', () => {
    const tok = signSessionToken(claims, SECRET, NOW, TTL);
    expect(verifySessionToken(tok, 'other-secret', NOW + 10)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const tok = signSessionToken(claims, SECRET, NOW, TTL);
    const [body, sig] = tok.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sid: 'evil', tid: 'tenant-1', iid: 'impound-1', iat: NOW, exp: NOW + TTL }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, NOW + 10)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('', SECRET, NOW)).toBeNull();
    expect(verifySessionToken('no-dot', SECRET, NOW)).toBeNull();
    expect(verifySessionToken('.', SECRET, NOW)).toBeNull();
    expect(verifySessionToken('abc.', SECRET, NOW)).toBeNull();
  });

  it('slides the window to a new expiry while preserving claims', () => {
    const tok = signSessionToken(claims, SECRET, NOW, TTL);
    const p = verifySessionToken(tok, SECRET, NOW + 100);
    if (!p) throw new Error('expected payload');
    const slid = slideSessionToken(p, SECRET, NOW + 100, TTL);
    const p2 = verifySessionToken(slid, SECRET, NOW + 100);
    expect(p2?.sid).toBe('sess-1');
    expect(p2?.exp).toBe(NOW + 100 + TTL);
    expect(p2?.exp).toBeGreaterThan(p.exp);
  });
});
