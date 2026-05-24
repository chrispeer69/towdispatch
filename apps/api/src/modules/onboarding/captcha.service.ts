/**
 * Captcha verification hook for public signup.
 *
 * Env-gated and stubbed for now (session scope: "Captcha hook (env-gated,
 * stub for now)"). When CAPTCHA_PROVIDER is unset / 'none', verification is a
 * no-op pass-through and the captchaToken on the signup payload is ignored.
 * When a provider is configured, a missing/empty token is rejected and the
 * provider call is stubbed to succeed — swap `verifyWithProvider` for a real
 * hCaptcha / reCAPTCHA / Turnstile call without touching the call sites.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';

@Injectable()
export class CaptchaService {
  private readonly log = new Logger(CaptchaService.name);

  /** '' | 'none' → disabled. 'hcaptcha' | 'recaptcha' | 'turnstile' → enabled. */
  private get provider(): string {
    return (process.env.CAPTCHA_PROVIDER ?? '').trim().toLowerCase();
  }

  get enabled(): boolean {
    const p = this.provider;
    return p !== '' && p !== 'none';
  }

  /**
   * Throws ForbiddenException(RATE_LIMITED) when captcha is enabled and the
   * token is missing or fails provider verification. No-op when disabled.
   */
  async assertValid(token: string | undefined): Promise<void> {
    if (!this.enabled) return;

    if (!token || token.trim() === '') {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Captcha verification is required.',
      });
    }

    const ok = await this.verifyWithProvider(token);
    if (!ok) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Captcha verification failed. Please try again.',
      });
    }
  }

  /**
   * Stub. Replace with a real provider HTTP call (siteverify) keyed on the
   * provider secret. Returns true so enabling CAPTCHA_PROVIDER in a non-prod
   * env doesn't block local testing before the secret is wired.
   */
  private async verifyWithProvider(_token: string): Promise<boolean> {
    this.log.debug(`captcha provider "${this.provider}" verification stubbed → pass`);
    return true;
  }
}
