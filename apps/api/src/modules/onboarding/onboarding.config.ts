/**
 * Onboarding pricing-tier + activation configuration.
 *
 * The repo has no subscription/plan-limit config today (dynamic-pricing-tiers
 * is service pricing; tier-offers is the Moat #3 discount engine). So the
 * free-tier truck allowance lives here as a small module-local constant,
 * overridable via env, rather than being threaded through the global
 * ConfigService (which is outside this session's file scope). Documented in
 * SESSION_25_DECISIONS.md (decision #3).
 */

export interface OnboardingTierConfig {
  /** Plan key persisted on onboarding_progress.tier. */
  readonly key: 'free' | 'starter' | 'pro';
  /** Hard cap on trucks a tenant on this tier may provision. */
  readonly maxTrucks: number;
  /** Hard cap on driver records. */
  readonly maxDrivers: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Free tier — what a self-serve signup activates immediately. Default 2 trucks
 * (the "1-2 trucks" pricing-tier guidance from the session scope), overridable
 * with ONBOARDING_FREE_TIER_MAX_TRUCKS / ONBOARDING_FREE_TIER_MAX_DRIVERS.
 */
export const FREE_TIER: OnboardingTierConfig = {
  key: 'free',
  get maxTrucks(): number {
    return intFromEnv('ONBOARDING_FREE_TIER_MAX_TRUCKS', 2);
  },
  get maxDrivers(): number {
    return intFromEnv('ONBOARDING_FREE_TIER_MAX_DRIVERS', 2);
  },
};

/** Public signup rate limit: 5 attempts / hour / IP (session scope). */
export const SIGNUP_RATE_LIMIT = 5;
export const SIGNUP_RATE_TTL_SECONDS = 60 * 60;
