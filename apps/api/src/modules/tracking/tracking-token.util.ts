/**
 * Token generation for tracking_links.
 *
 * 24 random bytes → base64url → 32-char string. ~192 bits of entropy is well
 * past the threshold any motivated attacker would brute force, even with a
 * leaked Postgres dump that gave them the (hashed) password column. Tokens
 * never appear in logs (we redact via the pino redact paths) and never in the
 * URL the customer pastes anywhere obvious — they're disposable per job.
 */
import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 24;

export function generateTrackingToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** True when the token is shaped like a generated one. */
export function isPlausibleToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22,64}$/.test(s);
}
