/**
 * TokenEncryptionService — AES-256-GCM at-rest encryption for OAuth tokens.
 *
 * Mirror of the pattern used for TOTP secrets in the auth module: a key is
 * derived from QBO_TOKEN_ENCRYPTION_KEY via SHA-256 (so any 32+ char string is
 * acceptable), a fresh 12-byte IV is generated per ciphertext, and the
 * ciphertext is stored as base64 of `iv || authTag || ciphertext`. The
 * service exposes only encrypt/decrypt — callers never see raw bytes.
 *
 * Why GCM: authenticated encryption, tamper-evident. A flipped bit raises a
 * decrypt error rather than silently returning corrupt data.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class TokenEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHash('sha256').update(config.quickbooks.tokenEncryptionKey, 'utf8').digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES) {
      throw new Error('TokenEncryptionService.decrypt: payload too short');
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  }
}
