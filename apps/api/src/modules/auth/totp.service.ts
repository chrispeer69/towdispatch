/**
 * TOTP scaffolding (RFC 6238 / Google Authenticator compatible). Wired up in
 * Session 2.0 but NOT enforced on login by default — users who run setup get
 * mfa_enabled=true and the login flow then routes them through /auth/mfa/login.
 *
 * Secrets are stored AES-256-GCM encrypted at rest. The encryption key comes
 * from TOTP_ENCRYPTION_KEY in env. Rotating that key means re-encrypting every
 * row — out of scope for this session.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { ConfigService } from '../../config/config.service.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

@Injectable()
export class TotpService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    // Derive a stable 32-byte key from the configured passphrase.
    this.key = createHash('sha256').update(this.config.totpEncryptionKey).digest();
    authenticator.options = { window: 1, step: 30 };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  buildOtpAuthUrl(opts: { account: string; issuer: string; secret: string }): string {
    return authenticator.keyuri(opts.account, opts.issuer, opts.secret);
  }

  async buildQrDataUrl(otpAuthUrl: string): Promise<string> {
    return qrcode.toDataURL(otpAuthUrl, { errorCorrectionLevel: 'M', margin: 2 });
  }

  verify(secret: string, token: string): boolean {
    try {
      return authenticator.check(token, secret);
    } catch {
      return false;
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + 16);
    const enc = buf.subarray(IV_LEN + 16);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
