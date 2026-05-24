/**
 * AES-256-GCM cipher for the self-serve portal's ID-last4 at rest (Session 55).
 *
 * Mirrors accounting/token-encryption.service.ts but is keyed by a DEDICATED
 * key (CUSTOMER_PORTAL_ID_ENCRYPTION_KEY) — never the QBO/SSO key (key
 * separation, SESSION_55_DECISIONS.md D7). Format: base64(iv ‖ authTag ‖ ct).
 * Pure functions (key injected) so they unit-test without NestJS.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptIdLast4(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptIdLast4(blob: string, secret: string): string {
  const key = deriveKey(secret);
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('decryptIdLast4: payload too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
