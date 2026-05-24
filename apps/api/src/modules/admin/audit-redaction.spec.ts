/**
 * Unit tests for audit-log secret redaction (Session 31 — SOC 2).
 * Pure functions, no database — always run in CI.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveKey, redactState } from './audit-redaction.js';

describe('isSensitiveKey', () => {
  it('flags hash/secret/password field names', () => {
    for (const k of [
      'password_hash',
      'password_reset_token_hash',
      'mfa_secret_encrypted',
      'mfa_backup_codes_hash',
      'token_hash',
      'refresh_token_hash',
      'totp_secret_encrypted',
      'PASSWORD_HASH',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });

  it('does not flag ordinary business fields', () => {
    for (const k of ['name', 'email', 'tenant_id', 'created_at', 'amount_cents', 'status', 'id']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('redactState', () => {
  it('returns null for null input', () => {
    expect(redactState(null)).toBeNull();
  });

  it('redacts a users row snapshot without dropping safe fields', () => {
    const usersRow = {
      id: 'u1',
      email: 'owner@example.com',
      role: 'owner',
      password_hash: '$argon2id$v=19$m=...$secrethash',
      mfa_secret_encrypted: 'AES:deadbeef',
      mfa_enabled: true,
    };
    const out = redactState(usersRow);
    expect(out?.password_hash).toBe(REDACTED);
    expect(out?.mfa_secret_encrypted).toBe(REDACTED);
    // Safe fields pass through untouched.
    expect(out?.email).toBe('owner@example.com');
    expect(out?.role).toBe('owner');
    expect(out?.mfa_enabled).toBe(true);
  });

  it('NEVER leaks a password_hash value in the output', () => {
    const out = redactState({ password_hash: 'super-secret-value' });
    expect(JSON.stringify(out)).not.toContain('super-secret-value');
  });

  it('recurses into nested objects and arrays', () => {
    const nested = {
      meta: { token_hash: 'abc', label: 'keep' },
      items: [{ secret_key: 'x', ok: 1 }],
    };
    const out = redactState(nested) as {
      meta: { token_hash: string; label: string };
      items: { secret_key: string; ok: number }[];
    };
    expect(out.meta.token_hash).toBe(REDACTED);
    expect(out.meta.label).toBe('keep');
    expect(out.items[0]?.secret_key).toBe(REDACTED);
    expect(out.items[0]?.ok).toBe(1);
  });

  it('does not mutate the input object', () => {
    const input = { password_hash: 'x', name: 'y' };
    redactState(input);
    expect(input.password_hash).toBe('x');
  });
});
