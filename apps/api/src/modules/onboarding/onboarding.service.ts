/**
 * OnboardingService — orchestrates self-serve onboarding ON TOP of the
 * existing auth module (which it never modifies).
 *
 *   start()              public. captcha → 5/hr/IP rate limit →
 *                        AuthService.signup (tenant + owner + verification
 *                        email, all unchanged) → create onboarding_progress
 *                        + emit account_created / free_tier_activated.
 *   getProgress()        tenant-scoped. Ensures a progress row exists,
 *                        refreshes derived activation milestones, computes
 *                        the resume step, returns the DTO.
 *   submitCompanyInfo()  updates tenant.name (via TenantsService) + persists
 *                        the collected company info in step_data.
 *   submitFirstUser()    invites the first teammate (UserInvitesService).
 *   submitFirstTruck()   creates the first truck (TrucksService), free-tier
 *                        truck-cap enforced.
 *   submitFirstDriver()  creates the first driver (FleetDriversService),
 *                        free-tier driver-cap enforced.
 *   skipStep()/complete()  advance / finalize the wizard.
 *
 * Every write is delegated to the canonical domain service so onboarding adds
 * no second source of truth; onboarding owns only progress + activation state.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type OnboardingProgress,
  drivers,
  onboardingProgress,
  trucks,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type CompanyInfoStepPayload,
  ERROR_CODES,
  type FirstDriverStepPayload,
  type FirstTruckStepPayload,
  type FirstUserStepPayload,
  type OnboardingChecklist,
  type OnboardingProgressDto,
  type OnboardingStartPayload,
  type OnboardingStartResponse,
  type OnboardingStep,
  createDriverSchema,
  createInviteSchema,
  createTruckSchema,
} from '@ustowdispatch/shared';
import { and, count, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { type AuthRequestMeta, AuthService } from '../auth/auth.service.js';
import { FleetDriversService } from '../fleet/drivers.service.js';
import { TrucksService } from '../fleet/trucks.service.js';
import { RateLimiterService } from '../redis/rate-limiter.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { UserInvitesService } from '../users/user-invites.service.js';
import { ActivationService } from './activation.service.js';
import { type CallerContext, toTenantContext } from './caller-context.js';
import { CaptchaService } from './captcha.service.js';
import { FREE_TIER, SIGNUP_RATE_LIMIT, SIGNUP_RATE_TTL_SECONDS } from './onboarding.config.js';

/** Wizard step order — drives the computed resume point. */
const STEP_ORDER: OnboardingStep[] = [
  'account',
  'verify_email',
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
  'dispatch_first_job',
  'completed',
];

@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
    private readonly trucks: TrucksService,
    private readonly fleetDrivers: FleetDriversService,
    private readonly invites: UserInvitesService,
    private readonly activation: ActivationService,
    private readonly captcha: CaptchaService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  // ===========================================================================
  // START (public)
  // ===========================================================================
  async start(
    input: OnboardingStartPayload,
    meta: AuthRequestMeta,
  ): Promise<OnboardingStartResponse> {
    await this.captcha.assertValid(input.captchaToken);

    // 5 signups / hour / IP. Falls back to a single shared bucket when the IP
    // is unknown (proxy misconfig) so the limit can't be trivially bypassed.
    const ipKey = meta.ipAddress && meta.ipAddress.length > 0 ? meta.ipAddress : 'unknown';
    const rate = await this.rateLimiter.check(
      `onboarding:start:ip:${ipKey}`,
      SIGNUP_RATE_LIMIT,
      SIGNUP_RATE_TTL_SECONDS,
    );
    if (!rate.allowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.RATE_LIMITED,
        message: `Too many signups from this network. Try again in ${Math.ceil(
          rate.retryAfterSeconds / 60,
        )} minutes.`,
      });
    }

    // Delegate the whole tenant+owner provisioning + verification email to the
    // unchanged auth module. captchaToken is intentionally dropped here.
    const auth = await this.auth.signup(
      {
        tenantName: input.tenantName,
        tenantSlug: input.tenantSlug,
        ownerName: input.ownerName,
        ownerEmail: input.ownerEmail,
        password: input.password,
      },
      meta,
    );

    const ctx: CallerContext = {
      tenantId: auth.tenant.id,
      userId: auth.user.id,
      role: auth.user.role,
      requestId: meta.requestId ?? '',
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    };

    await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      await tx
        .insert(onboardingProgress)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          currentStep: 'verify_email',
          stepsCompleted: ['account'],
          stepData: {},
          tier: FREE_TIER.key,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
    });

    await this.activation.emit(ctx, 'account_created', { slug: auth.tenant.slug });
    await this.activation.emit(ctx, 'free_tier_activated', { maxTrucks: FREE_TIER.maxTrucks });

    const progress = await this.getProgress(ctx);
    return { ...auth, onboarding: progress };
  }

  // ===========================================================================
  // PROGRESS (tenant-scoped)
  // ===========================================================================
  async getProgress(ctx: CallerContext): Promise<OnboardingProgressDto> {
    const row = await this.ensureProgress(ctx);
    const checklist = await this.activation.refreshDerivedAndBuildChecklist(ctx);
    const currentStep = this.computeCurrentStep(row, checklist);

    // Persist the recomputed resume step if it advanced (and not yet complete).
    if (currentStep !== row.currentStep && row.completedAt === null) {
      await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
        await tx
          .update(onboardingProgress)
          .set({ currentStep })
          .where(eq(onboardingProgress.id, row.id));
      });
    }

    const events = await this.activation.list(ctx);
    return {
      tenantId: ctx.tenantId,
      currentStep,
      stepsCompleted: this.normalizeSteps(row.stepsCompleted),
      stepData: (row.stepData as Record<string, unknown>) ?? {},
      tier: row.tier,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      checklist,
      activationEvents: events,
    };
  }

  // ===========================================================================
  // STEP: COMPANY INFO
  // ===========================================================================
  async submitCompanyInfo(
    ctx: CallerContext,
    payload: CompanyInfoStepPayload,
  ): Promise<OnboardingProgressDto> {
    await this.ensureProgress(ctx);

    // Update only tenant.name (no settings → bypasses the Company Profile
    // first-save validator, which requires all 17 fields). The full company
    // info is retained in step_data; the structured Company Profile remains
    // the single source of truth, completed later in Admin Settings.
    await this.tenants.updateCurrent(ctx, { name: payload.legalName });

    await this.markStepComplete(ctx, 'company_info', { companyInfo: payload });
    await this.activation.emit(ctx, 'company_info_completed', { timezone: payload.timezone });
    return this.getProgress(ctx);
  }

  // ===========================================================================
  // STEP: FIRST USER (invite)
  // ===========================================================================
  async submitFirstUser(
    ctx: CallerContext,
    payload: FirstUserStepPayload,
  ): Promise<OnboardingProgressDto> {
    await this.ensureProgress(ctx);
    const inviteInput = createInviteSchema.parse({
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
    });
    await this.invites.invite(ctx, inviteInput);
    await this.markStepComplete(ctx, 'first_user', {
      firstUser: { email: payload.email, role: payload.role },
    });
    // first_user_invited is emitted lazily by the activation derivation.
    return this.getProgress(ctx);
  }

  // ===========================================================================
  // STEP: FIRST TRUCK
  // ===========================================================================
  async submitFirstTruck(
    ctx: CallerContext,
    payload: FirstTruckStepPayload,
  ): Promise<OnboardingProgressDto> {
    await this.ensureProgress(ctx);
    await this.assertUnderTruckCap(ctx);

    const truckInput = createTruckSchema.parse({
      unitNumber: payload.unitNumber,
      truckType: payload.truckType,
      year: payload.year,
      make: payload.make,
      model: payload.model,
    });
    await this.trucks.create(ctx, truckInput);
    await this.markStepComplete(ctx, 'first_truck', {
      firstTruck: { unitNumber: payload.unitNumber },
    });
    return this.getProgress(ctx);
  }

  // ===========================================================================
  // STEP: FIRST DRIVER
  // ===========================================================================
  async submitFirstDriver(
    ctx: CallerContext,
    payload: FirstDriverStepPayload,
  ): Promise<OnboardingProgressDto> {
    await this.ensureProgress(ctx);
    await this.assertUnderDriverCap(ctx);

    const driverInput = createDriverSchema.parse({
      firstName: payload.firstName,
      lastName: payload.lastName,
      phone: payload.phone,
      email: payload.email,
    });
    await this.fleetDrivers.create(ctx, driverInput);
    await this.markStepComplete(ctx, 'first_driver', {
      firstDriver: { firstName: payload.firstName, lastName: payload.lastName },
    });
    return this.getProgress(ctx);
  }

  // ===========================================================================
  // SKIP / COMPLETE
  // ===========================================================================
  async skipStep(ctx: CallerContext, step: OnboardingStep): Promise<OnboardingProgressDto> {
    await this.ensureProgress(ctx);
    await this.markStepComplete(ctx, step);
    return this.getProgress(ctx);
  }

  async complete(ctx: CallerContext): Promise<OnboardingProgressDto> {
    const row = await this.ensureProgress(ctx);
    await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      await tx
        .update(onboardingProgress)
        .set({ currentStep: 'completed', completedAt: row.completedAt ?? new Date() })
        .where(eq(onboardingProgress.id, row.id));
    });
    await this.activation.emit(ctx, 'onboarding_completed', {});
    return this.getProgress(ctx);
  }

  // ===========================================================================
  // INTERNALS
  // ===========================================================================

  /** Reads the live progress row, creating one if it doesn't exist yet. */
  private async ensureProgress(ctx: CallerContext): Promise<OnboardingProgress> {
    return this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      const existing = await tx.query.onboardingProgress.findFirst({
        where: and(
          eq(onboardingProgress.tenantId, ctx.tenantId),
          isNull(onboardingProgress.deletedAt),
        ),
      });
      if (existing) return existing;

      const [created] = await tx
        .insert(onboardingProgress)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          currentStep: 'verify_email',
          stepsCompleted: ['account'],
          stepData: {},
          tier: FREE_TIER.key,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;

      // Lost an insert race — re-read.
      const row = await tx.query.onboardingProgress.findFirst({
        where: and(
          eq(onboardingProgress.tenantId, ctx.tenantId),
          isNull(onboardingProgress.deletedAt),
        ),
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Onboarding progress could not be initialized',
        });
      }
      return row;
    });
  }

  /** Marks a step done + merges any captured step data. */
  private async markStepComplete(
    ctx: CallerContext,
    step: OnboardingStep,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      const row = await tx.query.onboardingProgress.findFirst({
        where: and(
          eq(onboardingProgress.tenantId, ctx.tenantId),
          isNull(onboardingProgress.deletedAt),
        ),
      });
      if (!row) return;

      const completed = new Set(this.normalizeSteps(row.stepsCompleted));
      completed.add(step);
      const stepData = {
        ...((row.stepData as Record<string, unknown>) ?? {}),
        ...(data ?? {}),
      };
      await tx
        .update(onboardingProgress)
        .set({ stepsCompleted: [...completed], stepData })
        .where(eq(onboardingProgress.id, row.id));
    });
  }

  private async assertUnderTruckCap(ctx: CallerContext): Promise<void> {
    const n = await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      const [r] = await tx.select({ n: count() }).from(trucks).where(isNull(trucks.deletedAt));
      return r?.n ?? 0;
    });
    if (n >= FREE_TIER.maxTrucks) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: `Your ${FREE_TIER.key} plan allows up to ${FREE_TIER.maxTrucks} trucks. Upgrade to add more.`,
      });
    }
  }

  private async assertUnderDriverCap(ctx: CallerContext): Promise<void> {
    const n = await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      const [r] = await tx.select({ n: count() }).from(drivers).where(isNull(drivers.deletedAt));
      return r?.n ?? 0;
    });
    if (n >= FREE_TIER.maxDrivers) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: `Your ${FREE_TIER.key} plan allows up to ${FREE_TIER.maxDrivers} drivers. Upgrade to add more.`,
      });
    }
  }

  /** First step whose completion flag is false; 'completed' when all done. */
  private computeCurrentStep(
    row: OnboardingProgress,
    checklist: OnboardingChecklist,
  ): OnboardingStep {
    if (row.completedAt) return 'completed';
    const explicit = new Set(this.normalizeSteps(row.stepsCompleted));
    const done: Record<OnboardingStep, boolean> = {
      account: true,
      verify_email: checklist.emailVerified,
      company_info: explicit.has('company_info') || checklist.companyInfoCompleted,
      first_user: explicit.has('first_user') || checklist.firstUserInvited,
      first_truck: explicit.has('first_truck') || checklist.firstTruckAdded,
      first_driver: explicit.has('first_driver') || checklist.firstDriverAdded,
      dispatch_first_job: explicit.has('dispatch_first_job') || checklist.firstJobDispatched,
      completed: false,
    };
    for (const step of STEP_ORDER) {
      if (step === 'completed') break;
      if (!done[step]) return step;
    }
    return 'completed';
  }

  /** Filters persisted step strings down to known OnboardingStep values. */
  private normalizeSteps(raw: string[] | null): OnboardingStep[] {
    const known = new Set<string>(STEP_ORDER);
    return (raw ?? []).filter((s): s is OnboardingStep => known.has(s));
  }
}
