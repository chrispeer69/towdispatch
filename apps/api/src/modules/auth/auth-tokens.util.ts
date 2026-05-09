/**
 * One-shot token utility for email verification and password reset.
 * Both flows share the same shape:
 *   - generate 32 random bytes
 *   - emit base64url to the user via email
 *   - persist sha256(plain) at rest (NOT argon2id — these are one-shot, single
 *     lookup, expire fast; the constant-time SHA compare is fine and lets us
 *     index/look up in O(1) rather than scanning rows)
 *
 * Hashes are plain hex strings so they fit in a single equality lookup.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const generatePlainToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (plain: string): string =>
  createHash('sha256').update(plain).digest('hex');

export const verifyTokenHash = (plain: string, expected: string): boolean => {
  const got = hashToken(plain);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
};
