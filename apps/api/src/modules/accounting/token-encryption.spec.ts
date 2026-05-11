import { describe, expect, it } from 'vitest';
import type { ConfigService } from '../../config/config.service.js';
import { TokenEncryptionService } from './token-encryption.service.js';

const stubConfig = (key: string): ConfigService =>
  ({
    quickbooks: {
      tokenEncryptionKey: key,
    },
  }) as unknown as ConfigService;

describe('TokenEncryptionService', () => {
  it('round-trips arbitrary tokens', () => {
    const svc = new TokenEncryptionService(stubConfig('this-is-a-test-key-with-32-plus-chars'));
    const plain = 'access_token_aaaaaaaaaa';
    const cipher = svc.encrypt(plain);
    expect(cipher).not.toContain(plain);
    expect(svc.decrypt(cipher)).toBe(plain);
  });

  it('produces a different ciphertext for the same plaintext (fresh IV)', () => {
    const svc = new TokenEncryptionService(stubConfig('this-is-a-test-key-with-32-plus-chars'));
    const a = svc.encrypt('same-input');
    const b = svc.encrypt('same-input');
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe('same-input');
    expect(svc.decrypt(b)).toBe('same-input');
  });

  it('rejects tampered ciphertext (GCM tag check)', () => {
    const svc = new TokenEncryptionService(stubConfig('this-is-a-test-key-with-32-plus-chars'));
    const cipher = svc.encrypt('payload-x');
    const buf = Buffer.from(cipher, 'base64');
    // Flip a byte deep in the ciphertext body
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0x01;
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });
});
