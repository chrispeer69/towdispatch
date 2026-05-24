/**
 * Onboarding contracts — kept LOCAL to this module on purpose.
 *
 * packages/shared/src/schemas is out of this session's allowed file scope, so
 * the onboarding-specific Zod schemas, literal unions, and DTO types live here.
 * Entity-creation steps (company info, first user/truck/driver) reuse the
 * already-shared schemas by import in the web layer; the API only needs the
 * funnel contracts below.
 */
import { signupSchema, verifyEmailSchema } from '@ustowdispatch/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------
// Literal unions — single source of truth shared with onboarding.tables.ts
// and the SQL CHECK constraints in 0036_onboarding.sql.
// ---------------------------------------------------------------------

/** Ordered wizard steps. `activate`/`completed` are terminal/system steps. */
export const ONBOARDING_STEPS = [
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
  'activate',
  'completed',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps the wizard PATCHes data into (excludes terminal/system steps). */
export const EDITABLE_STEPS = [
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
] as const;
export type EditableStep = (typeof EDITABLE_STEPS)[number];

/** Linear order the wizard walks; drives the computed `nextStep`. */
export const STEP_ORDER: readonly OnboardingStep[] = [
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
  'activate',
  'completed',
] as const;

export const ACTIVATION_EVENTS = [
  'account_created',
  'email_verified',
  'company_info_completed',
  'first_user_invited',
  'first_truck_added',
  'first_driver_added',
  'free_tier_activated',
  'first_job_dispatched',
  'onboarding_completed',
] as const;
export type ActivationEventType = (typeof ACTIVATION_EVENTS)[number];

export const ONBOARDING_TIERS = ['free', 'starter', 'pro'] as const;
export type OnboardingTier = (typeof ONBOARDING_TIERS)[number];

/**
 * Max live trucks permitted per pricing tier. `null` = unlimited. Self-serve
 * onboarding activates `free` (≤ 2 trucks); the paid tiers are listed so the
 * cap check has a complete table once billing wires them up.
 */
export const TIER_TRUCK_LIMITS: Record<OnboardingTier, number | null> = {
  free: 2,
  starter: 25,
  pro: null,
};

// ---------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------

/** Public signup wrapper body — the shared signup payload + an optional
 * captcha token (verified only when ONBOARDING_CAPTCHA_ENABLED=true). */
export const onboardingSignupSchema = signupSchema.extend({
  captchaToken: z.string().max(4096).optional(),
});
export type OnboardingSignupPayload = z.infer<typeof onboardingSignupSchema>;

/** Public verify-email wrapper body (delegates to AuthService.verifyEmail). */
export const onboardingVerifyEmailSchema = verifyEmailSchema;
export type OnboardingVerifyEmailPayload = z.infer<typeof onboardingVerifyEmailSchema>;

export const stepParamSchema = z.object({
  step: z.enum(EDITABLE_STEPS),
});

/**
 * Persisted resumable snapshot for a wizard step. The shape is intentionally
 * open (jsonb) — the real entity validation happens at the composed endpoint
 * the web layer calls (PATCH /tenants/current, POST /fleet/trucks, ...). This
 * only stores what the form had so a reload can rehydrate.
 */
export const saveStepSchema = z.object({
  data: z.record(z.string(), z.unknown()).default({}),
  /** When true, mark the step complete and advance current_step. */
  complete: z.boolean().default(true),
});
export type SaveStepPayload = z.infer<typeof saveStepSchema>;

export const activateTierSchema = z.object({
  // Self-serve only activates the free tier today; the enum leaves room for
  // upgrade flows without a contract change.
  tier: z.enum(ONBOARDING_TIERS).default('free'),
});
export type ActivateTierPayload = z.infer<typeof activateTierSchema>;

// ---------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------

export interface OnboardingProgressDto {
  id: string;
  tenantId: string;
  currentStep: OnboardingStep;
  stepsCompleted: OnboardingStep[];
  stepData: Record<string, unknown>;
  tier: OnboardingTier;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationEventDto {
  eventType: ActivationEventType;
  occurredAt: string;
}

export interface OnboardingStateDto {
  progress: OnboardingProgressDto;
  /** Milestones reached, recomputed from real tenant state on every read. */
  activation: ActivationEventDto[];
  /** Convenience flags for the wizard's progress UI. */
  milestones: Record<ActivationEventType, boolean>;
  /** Next step the wizard should land on (null once completed). */
  nextStep: OnboardingStep | null;
  /** Truck cap for the current tier (null = unlimited). */
  truckLimit: number | null;
}
