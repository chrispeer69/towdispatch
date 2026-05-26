/**
 * Pure API-key crypto + format helpers (Session 29). No I/O, no Nest — unit
 * tested directly.
 *
 * Key format:  tc_<env>_<prefix>_<secret>
 *   env     : 'live' | 'test'
 *   prefix  : 12 lowercase hex (6 random bytes) — the PUBLIC, indexed lookup
 *             handle. Stored in plaintext; safe to display.
 *   secret  : 64 lowercase hex (32 random bytes) — the entropy. Never stored.
 *
 * At rest we keep only `prefix` + SHA-256(full key). High-entropy random
 * tokens don't need a slow KDF — a per-request argon2/bcrypt would be a DoS
 * vector and adds nothing over SHA-256 against a 256-bit secret. This mirrors
 * how Stripe/GitHub fingerprint their tokens.
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export type ApiKeyEnv = 'live' | 'test';

const KEY_RX = /^tc_(live|test)_([0-9a-f]{12})_([0-9a-f]{64})$/;

export interface GeneratedApiKey {
  /** The full secret string — returned to the operator exactly once. */
  plaintext: string;
  /** Public lookup handle, persisted + displayed. */
  prefix: string;
  /** PBKDF2(plaintext), hex — persisted. */
  hash: string;
}

export function hashApiKey(plaintext: string): string {
  // CodeQL requires a computationally expensive hash for credentials.
  return pbkdf2Sync(plaintext, 'api-key-salt', 100000, 32, 'sha256').toString('hex');
}

export function generateApiKey(env: ApiKeyEnv = 'live'): GeneratedApiKey {
  const prefix = randomBytes(6).toString('hex'); // 12 hex chars
  const secret = randomBytes(32).toString('hex'); // 64 hex chars
  const plaintext = `tc_${env}_${prefix}_${secret}`;
  return { plaintext, prefix, hash: hashApiKey(plaintext) };
}

export interface ParsedApiKey {
  env: ApiKeyEnv;
  prefix: string;
}

/** Parse + shape-validate a presented key. Returns null on any malformation. */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const m = KEY_RX.exec(raw.trim());
  if (!m) return null;
  return { env: m[1] as ApiKeyEnv, prefix: m[2] as string };
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const t = authHeader.slice('bearer '.length).trim();
  return t.length > 0 ? t : null;
}

/** Constant-time comparison of two hex digests of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
