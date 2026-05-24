/**
 * Public Marketplace API (Session 46) — opaque-token + PKCE primitives.
 *
 * Mirrors auth-tokens.util.ts: opaque high-entropy secrets, stored as a
 * sha256 hex digest (NOT argon2id — these are 256-bit random strings, so a
 * single constant-time SHA compare is sufficient and lets us index/look up in
 * O(1) rather than scanning rows). The OAuth tokens, client secret, auth code,
 * and webhook secret all share this shape; the prefix is purely cosmetic so a
 * leaked credential is recognizable in logs/dashboards.
 *
 * PKCE (RFC 7636) verification supports only S256: the challenge MUST equal
 * base64url(sha256(verifier)). `plain` is intentionally unsupported.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIXES = {
  accessToken: 'usto_at_',
  refreshToken: 'usto_rt_',
  clientSecret: 'usto_cs_',
  authCode: 'usto_ac_',
  webhookSecret: 'whsec_',
} as const;

/** 256 bits of entropy, base64url, with a human-recognizable prefix. */
export const generateOpaqueToken = (prefix: string): string =>
  `${prefix}${randomBytes(32).toString('base64url')}`;

export const hashSecret = (plain: string): string =>
  createHash('sha256').update(plain).digest('hex');

/** Constant-time compare of a presented secret against a stored sha256 hex. */
export const verifySecretHash = (plain: string, expectedHash: string): boolean => {
  const got = hashSecret(plain);
  if (got.length !== expectedHash.length) return false;
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expectedHash, 'hex'));
};

/**
 * RFC 7636 §4.6: verify a PKCE code_verifier against the stored S256
 * code_challenge. Returns false (never throws) on any malformed input so the
 * caller can answer a uniform `invalid_grant`.
 */
export const verifyPkceS256 = (verifier: string, challenge: string): boolean => {
  if (typeof verifier !== 'string' || typeof challenge !== 'string') return false;
  // RFC 7636 §4.1: verifier is 43–128 chars from the unreserved set.
  if (verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  if (computed.length !== challenge.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
  } catch {
    return false;
  }
};

/**
 * Parses a duration like `15m`, `1h`, `30d`, or a bare seconds integer, into
 * seconds. Same grammar as the JWT service's parser; duplicated here so the
 * marketplace module has no dependency on auth internals.
 */
export const parseDurationSeconds = (input: string): number => {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) {
    const n = Number.parseInt(input, 10);
    if (!Number.isFinite(n)) throw new Error(`Invalid duration: ${input}`);
    return n;
  }
  const value = Number.parseInt(m[1] ?? '0', 10);
  const unit = m[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
  return value * (multipliers[unit] ?? 1);
};

/** HMAC-SHA256 signature (hex) of a webhook body, keyed by the app secret. */
export const signWebhookBody = (secret: string, body: string): string =>
  createHmac('sha256', secret).update(body).digest('hex');
