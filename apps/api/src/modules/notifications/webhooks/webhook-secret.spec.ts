/**
 * Encryption round-trip. We exercise the GCM auth-tag path by tampering a
 * byte after encryption and asserting decrypt throws — that's the
 * tamper-evidence guarantee callers rely on when storing secrets at rest.
 */
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../../../config/config.service.js';
import { WebhookSecretService } from './webhook-secret.service.js';

function makeService(): WebhookSecretService {
  const fakeConfig = {
    notifications: {
      webhookSecretKey: 'a'.repeat(48),
    },
  } as unknown as ConfigService;
  return new WebhookSecretService(fakeConfig);
}

describe('WebhookSecretService', () => {
  const svc = makeService();

  it('round-trips an arbitrary secret', () => {
    const plain = 'shh-this-is-very-secret-12345';
    const blob = svc.encrypt(plain);
    expect(blob).not.toContain(plain);
    expect(svc.decrypt(blob)).toBe(plain);
  });

  it('rejects tampered ciphertext', () => {
    const blob = svc.encrypt('payload');
    const raw = Buffer.from(blob, 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    const tampered = raw.toString('base64');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('generates a 64-char hex secret', () => {
    const s = svc.generate();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
    const a = svc.encrypt('repeat');
    const b = svc.encrypt('repeat');
    expect(a).not.toBe(b);
  });
});
