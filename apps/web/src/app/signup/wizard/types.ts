/**
 * Local mirror of the onboarding API DTOs. packages/shared is out of this
 * session's allowed scope, so the wizard keeps its own copy of the response
 * shape (kept in sync with apps/api/.../onboarding.contracts.ts).
 */
export type OnboardingStep =
  | 'company_info'
  | 'first_user'
  | 'first_truck'
  | 'first_driver'
  | 'activate'
  | 'completed';

export type ActivationEventType =
  | 'account_created'
  | 'email_verified'
  | 'company_info_completed'
  | 'first_user_invited'
  | 'first_truck_added'
  | 'first_driver_added'
  | 'free_tier_activated'
  | 'first_job_dispatched'
  | 'onboarding_completed';

export interface OnboardingProgressDto {
  id: string;
  tenantId: string;
  currentStep: OnboardingStep;
  stepsCompleted: OnboardingStep[];
  stepData: Record<string, unknown>;
  tier: 'free' | 'starter' | 'pro';
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
  activation: ActivationEventDto[];
  milestones: Record<ActivationEventType, boolean>;
  nextStep: OnboardingStep | null;
  truckLimit: number | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}
