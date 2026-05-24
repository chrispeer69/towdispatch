import { afterEach, describe, expect, it, vi } from 'vitest';
import { FREE_TIER, SIGNUP_RATE_LIMIT, SIGNUP_RATE_TTL_SECONDS } from './onboarding.config.js';

describe('onboarding.config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults the free tier to 2 trucks / 2 drivers when unset', () => {
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_TRUCKS', '');
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_DRIVERS', '');
    expect(FREE_TIER.key).toBe('free');
    expect(FREE_TIER.maxTrucks).toBe(2);
    expect(FREE_TIER.maxDrivers).toBe(2);
  });

  it('honors env overrides', () => {
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_TRUCKS', '5');
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_DRIVERS', '7');
    expect(FREE_TIER.maxTrucks).toBe(5);
    expect(FREE_TIER.maxDrivers).toBe(7);
  });

  it('falls back to the default on a non-positive / non-numeric override', () => {
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_TRUCKS', 'abc');
    expect(FREE_TIER.maxTrucks).toBe(2);
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_TRUCKS', '0');
    expect(FREE_TIER.maxTrucks).toBe(2);
    vi.stubEnv('ONBOARDING_FREE_TIER_MAX_TRUCKS', '');
    expect(FREE_TIER.maxTrucks).toBe(2);
  });

  it('exposes the 5/hour signup rate limit', () => {
    expect(SIGNUP_RATE_LIMIT).toBe(5);
    expect(SIGNUP_RATE_TTL_SECONDS).toBe(3600);
  });
});
