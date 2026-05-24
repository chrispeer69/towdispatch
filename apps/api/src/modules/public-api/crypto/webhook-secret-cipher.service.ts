/**
 * WebhookSecretCipher — AES-256-GCM at-rest encryption for webhook signing
 * secrets. Same construction as TokenEncryptionService (QBO) / TOTP secrets:
 * key derived from WEBHOOK_SIGNING_ENCRYPTION_KEY via SHA-256, fresh 12-byte
 * IV per ciphertext, stored as base64(iv || authTag || ciphertext).
 *
 * The secret must be reversible because the delivery worker decrypts it to
 * HMAC-sign each request — a hash would make signing impossible.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class WebhookSecretCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHash('sha256').update(config.publicApi.signingEncryptionKey, 'utf8').digest();
  }

  /** Mint a fresh, high-entropy signing secret (whsec_<48 hex>). */
  generateSecret(): string {
    return `whsec_${randomBytes(24).toString('hex')}`;
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
      throw new Error('WebhookSecretCipher.decrypt: payload too short');
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
