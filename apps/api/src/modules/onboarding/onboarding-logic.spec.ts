import { afterEach, describe, expect, it, vi } from 'vitest';
import { captchaEnabled, verifyCaptcha } from './captcha.js';
import { TIER_TRUCK_LIMITS } from './onboarding.contracts.js';
import { nextStepFrom } from './onboarding.service.js';

describe('nextStepFrom', () => {
  it('returns the first editable step when nothing is done', () => {
    expect(nextStepFrom([], null)).toBe('company_info');
  });

  it('advances through the editable steps in order', () => {
    expect(nextStepFrom(['company_info'], null)).toBe('first_user');
    expect(nextStepFrom(['company_info', 'first_user'], null)).toBe('first_truck');
    expect(nextStepFrom(['company_info', 'first_user', 'first_truck'], null)).toBe('first_driver');
  });

  it('returns `activate` once every editable step is done', () => {
    expect(nextStepFrom(['company_info', 'first_user', 'first_truck', 'first_driver'], null)).toBe(
      'activate',
    );
  });

  it('returns null once the wizard is completed', () => {
    expect(nextStepFrom(['company_info'], new Date())).toBeNull();
  });

  it('is order-independent — looks at membership, not sequence', () => {
    // first_user done but company_info not → still points back to company_info.
    expect(nextStepFrom(['first_user'], null)).toBe('company_info');
  });
});

describe('captcha gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats any value other than the literal "true" as disabled (passes any token)', async () => {
    vi.stubEnv('ONBOARDING_CAPTCHA_ENABLED', 'false');
    expect(captchaEnabled()).toBe(false);
    expect(await verifyCaptcha(undefined)).toBe(true);
    expect(await verifyCaptcha('')).toBe(true);

    vi.stubEnv('ONBOARDING_CAPTCHA_ENABLED', '1');
    expect(captchaEnabled()).toBe(false);
    vi.stubEnv('ONBOARDING_CAPTCHA_ENABLED', 'TRUE');
    expect(captchaEnabled()).toBe(false);
  });

  it('when enabled, requires a non-empty token', async () => {
    vi.stubEnv('ONBOARDING_CAPTCHA_ENABLED', 'true');
    expect(captchaEnabled()).toBe(true);
    expect(await verifyCaptcha(undefined)).toBe(false);
    expect(await verifyCaptcha('   ')).toBe(false);
    expect(await verifyCaptcha('a-real-token')).toBe(true);
  });
});

describe('TIER_TRUCK_LIMITS', () => {
  it('caps the free tier at 2 trucks', () => {
    expect(TIER_TRUCK_LIMITS.free).toBe(2);
  });

  it('treats the pro tier as unlimited', () => {
    expect(TIER_TRUCK_LIMITS.pro).toBeNull();
  });
});
