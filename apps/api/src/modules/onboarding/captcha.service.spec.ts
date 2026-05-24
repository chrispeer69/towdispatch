import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptchaService } from './captcha.service.js';

describe('CaptchaService', () => {
  let svc: CaptchaService;

  beforeEach(() => {
    svc = new CaptchaService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled when CAPTCHA_PROVIDER is empty', () => {
    vi.stubEnv('CAPTCHA_PROVIDER', '');
    expect(svc.enabled).toBe(false);
  });

  it("is disabled when CAPTCHA_PROVIDER is 'none'", () => {
    vi.stubEnv('CAPTCHA_PROVIDER', 'none');
    expect(svc.enabled).toBe(false);
  });

  it('passes through (no-op) when disabled even with no token', async () => {
    vi.stubEnv('CAPTCHA_PROVIDER', '');
    await expect(svc.assertValid(undefined)).resolves.toBeUndefined();
  });

  it('is enabled when a provider is configured', () => {
    vi.stubEnv('CAPTCHA_PROVIDER', 'hcaptcha');
    expect(svc.enabled).toBe(true);
  });

  it('rejects a missing token when enabled', async () => {
    vi.stubEnv('CAPTCHA_PROVIDER', 'turnstile');
    await expect(svc.assertValid(undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertValid('   ')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes a present token when enabled (stub verifier returns true)', async () => {
    vi.stubEnv('CAPTCHA_PROVIDER', 'recaptcha');
    await expect(svc.assertValid('token-abc')).resolves.toBeUndefined();
  });
});
