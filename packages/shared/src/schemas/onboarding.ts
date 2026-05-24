/**
 * Self-Serve Onboarding contract (Session 25).
 *
 * These schemas run on both client (react-hook-form via the Zod resolver in
 * the signup wizard) and server (NestJS ZodBody). Onboarding composes on top
 * of the existing auth module: POST /onboarding/start delegates to
 * AuthService.signup (which already provisions tenant + owner + email-
 * verification token + verification email), then records wizard progress and
 * the first activation events. The wizard's per-step submit endpoints are
 * tenant-scoped and run after login.
 *
 * The enum value arrays are intentionally duplicated from
 * packages/db/src/schema (onboarding-progress.ts, tenant-activation-events.ts)
 * because @ustowdispatch/shared has no dependency on @ustowdispatch/db — the
 * same independent-duplication pattern the existing fleet / truck enums use.
 */
import { z } from 'zod';
import { ROLE_VALUES } from '../constants/roles';
import { signupSchema } from './auth';
import { phoneE164Schema, usStateSchema } from './customer';
import { truckTypeValues } from './fleet';
import { emailSchema } from './user';

// ---------- step / event vocabularies ----------
export const onboardingStepValues = [
  'account',
  'verify_email',
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
  'dispatch_first_job',
  'completed',
] as const;
export type OnboardingStep = (typeof onboardingStepValues)[number];

export const onboardingTierValues = ['free', 'starter', 'pro'] as const;
export type OnboardingTier = (typeof onboardingTierValues)[number];

export const activationEventTypeValues = [
  'account_created',
  'email_verified',
  'company_info_completed',
  'first_user_invited',
  'first_truck_added',
  'first_driver_added',
  'first_job_dispatched',
  'free_tier_activated',
  'onboarding_completed',
] as const;
export type ActivationEventType = (typeof activationEventTypeValues)[number];

// ---------- POST /onboarding/start (public) ----------
/**
 * Signup fields + an optional captcha token. The captcha is validated only
 * when CAPTCHA_PROVIDER is configured server-side; otherwise the field is
 * ignored (env-gated stub). Mirrors the flat auth signupSchema so the public
 * landing form and the API agree.
 */
export const onboardingStartSchema = signupSchema
  .extend({
    captchaToken: z.string().max(4096).optional(),
  })
  .strict();
export type OnboardingStartPayload = z.infer<typeof onboardingStartSchema>;

// ---------- wizard step: company info ----------
/**
 * A light first-touch subset of the full Company Profile (the full 17-field
 * profile is completed later in Admin Settings). `legalName` updates
 * tenants.name; the rest are merged into tenants.settings. Timezone is
 * required so all later presentation can localize from a known IANA zone.
 */
export const companyInfoStepSchema = z
  .object({
    legalName: z.string().min(1).max(120),
    dbaName: z.string().max(120).optional(),
    phone: phoneE164Schema.optional(),
    timezone: z.string().min(1).max(64),
    addressLine1: z.string().min(1).max(160),
    addressLine2: z.string().max(160).optional(),
    city: z.string().min(1).max(120),
    state: usStateSchema,
    postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/, 'US ZIP (12345 or 12345-6789)'),
  })
  .strict();
export type CompanyInfoStepPayload = z.infer<typeof companyInfoStepSchema>;

// ---------- wizard step: first user (invite) ----------
/**
 * Invites the first additional teammate. Goes through the existing
 * user-invite flow (email + role); the teammate sets their own password via
 * the invite link, so no password is collected here.
 */
export const firstUserStepSchema = z
  .object({
    email: emailSchema,
    fullName: z.string().min(1).max(120),
    role: z.enum(ROLE_VALUES).default('dispatcher'),
  })
  .strict();
export type FirstUserStepPayload = z.infer<typeof firstUserStepSchema>;

// ---------- wizard step: first truck ----------
// truckTypeValues is imported from ./fleet (single source of truth) so the
// onboarding step and the full createTruckSchema never drift.
export const firstTruckStepSchema = z
  .object({
    unitNumber: z.string().min(1).max(40),
    truckType: z.enum(truckTypeValues).default('light_duty'),
    year: z
      .string()
      .regex(/^[0-9]{4}$/, '4-digit year required')
      .optional(),
    make: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
  })
  .strict();
export type FirstTruckStepPayload = z.infer<typeof firstTruckStepSchema>;

// ---------- wizard step: first driver ----------
export const firstDriverStepSchema = z
  .object({
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
    phone: phoneE164Schema.optional(),
    email: z.string().email().max(254).optional(),
  })
  .strict();
export type FirstDriverStepPayload = z.infer<typeof firstDriverStepSchema>;

// ---------- skip a step ----------
export const skipStepSchema = z
  .object({
    step: z.enum(onboardingStepValues),
  })
  .strict();
export type SkipStepPayload = z.infer<typeof skipStepSchema>;

// ---------- response DTOs ----------
export const activationEventDtoSchema = z.object({
  eventType: z.enum(activationEventTypeValues),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.unknown()),
});
export type ActivationEventDto = z.infer<typeof activationEventDtoSchema>;

/**
 * Derived checklist surfaced to the wizard. Each flag is computed from real
 * tenant state (user.emailVerifiedAt, truck/driver counts, dispatched job
 * count) rather than trusted from the client.
 */
export const onboardingChecklistSchema = z.object({
  accountCreated: z.boolean(),
  emailVerified: z.boolean(),
  companyInfoCompleted: z.boolean(),
  firstUserInvited: z.boolean(),
  firstTruckAdded: z.boolean(),
  firstDriverAdded: z.boolean(),
  firstJobDispatched: z.boolean(),
});
export type OnboardingChecklist = z.infer<typeof onboardingChecklistSchema>;

export const onboardingProgressDtoSchema = z.object({
  tenantId: z.string().uuid(),
  currentStep: z.enum(onboardingStepValues),
  stepsCompleted: z.array(z.enum(onboardingStepValues)),
  stepData: z.record(z.unknown()),
  tier: z.enum(onboardingTierValues),
  completedAt: z.string().datetime().nullable(),
  checklist: onboardingChecklistSchema,
  activationEvents: z.array(activationEventDtoSchema),
});
export type OnboardingProgressDto = z.infer<typeof onboardingProgressDtoSchema>;

/**
 * POST /onboarding/start response — the standard authenticated session shape
 * plus the freshly-created onboarding progress. Kept structurally compatible
 * with AuthenticatedResponse so the web client can reuse its session handling.
 */
export const onboardingStartResponseSchema = z.object({
  status: z.literal('authenticated'),
  user: z.object({
    id: z.string().uuid(),
    email: emailSchema,
    firstName: z.string(),
    lastName: z.string(),
    role: z.string(),
    emailVerifiedAt: z.string().datetime().nullable(),
    mfaEnabled: z.boolean(),
  }),
  tenant: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    status: z.string(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  onboarding: onboardingProgressDtoSchema,
});
export type OnboardingStartResponse = z.infer<typeof onboardingStartResponseSchema>;
