/**
 * WebhookSecretService — AES-256-GCM at-rest encryption for outbound webhook
 * shared secrets.
 *
 * Identical algorithm and shape to TokenEncryptionService — the only reason
 * we don't reuse that class is its key is bound to QBO_TOKEN_ENCRYPTION_KEY.
 * Webhook secrets need a separate rotation lifecycle so they get their own
 * derived key from WEBHOOK_SECRET_ENCRYPTION_KEY.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class WebhookSecretService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHash('sha256')
      .update(config.notifications.webhookSecretKey, 'utf8')
      .digest();
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
      throw new Error('WebhookSecretService.decrypt: payload too short');
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  }

  /** Generate a fresh 64-char hex secret. */
  generate(): string {
    return randomBytes(32).toString('hex');
  }
}
