/**
 * Env-gated captcha verification.
 *
 * config.service.ts is out of this session's allowed scope, so the gate reads
 * process.env directly. Disabled by default: when ONBOARDING_CAPTCHA_ENABLED is
 * not exactly "true", verification is a no-op pass so dev/CI signups are not
 * blocked.
 *
 * When enabled this is still a STUB — it only asserts a non-empty token is
 * present. Wiring a real provider (hCaptcha / reCAPTCHA siteverify) is a
 * documented follow-up; the seam is here so callers don't change when it lands.
 */
export function captchaEnabled(): boolean {
  return process.env.ONBOARDING_CAPTCHA_ENABLED === 'true';
}

export async function verifyCaptcha(token: string | undefined): Promise<boolean> {
  if (!captchaEnabled()) return true;
  // TODO(captcha): replace with a real provider siteverify call.
  return typeof token === 'string' && token.trim().length > 0;
}
