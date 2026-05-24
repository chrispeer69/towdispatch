import { describe, expect, it } from 'vitest';
import { decryptIdLast4, encryptIdLast4 } from './id-cipher.js';

const KEY = 'self-serve-portal-id-encryption-key-32+chars-please';

describe('id-cipher (AES-256-GCM)', () => {
  it('round-trips the last 4 and never stores them in cleartext', () => {
    const blob = encryptIdLast4('1234', KEY);
    expect(blob).not.toContain('1234');
    expect(decryptIdLast4(blob, KEY)).toBe('1234');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptIdLast4('1234', KEY)).not.toBe(encryptIdLast4('1234', KEY));
  });

  it('fails to decrypt with the wrong key (auth tag)', () => {
    const blob = encryptIdLast4('1234', KEY);
    expect(() => decryptIdLast4(blob, 'a-different-key-of-sufficient-length-here')).toThrow();
  });

  it('rejects a truncated payload', () => {
    expect(() => decryptIdLast4('AAAA', KEY)).toThrow(/too short/);
  });
});
