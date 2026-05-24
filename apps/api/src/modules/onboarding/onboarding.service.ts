/**
 * OnboardingService — owns onboarding_progress + tenant_activation_events.
 *
 * It does NOT create trucks/drivers/users/jobs itself (the web wizard composes
 * the existing fleet/users/dispatch endpoints for that). Its job is to persist
 * resumable wizard progress and to maintain an idempotent activation-milestone
 * ledger, recomputed from REAL tenant state on every read.
 *
 * Activation semantics (eventual-consistency): milestones are emitted whenever
 * the onboarding state is next OBSERVED (a /onboarding/* read or /recompute),
 * not at the instant the underlying event happens. In particular
 * `first_job_dispatched` fires the next time onboarding state is read after a
 * job leaves status='new' — it is not a real-time hook into the dispatch
 * module (which is out of scope to modify). See SESSION_25_DECISIONS.md D6.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { drivers, jobs, trucks, userInvites, users, uuidv7 } from '@ustowdispatch/db';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-aware-db.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import {
  ACTIVATION_EVENTS,
  type ActivateTierPayload,
  type ActivationEventType,
  EDITABLE_STEPS,
  type EditableStep,
  type OnboardingProgressDto,
  type OnboardingStateDto,
  type OnboardingStep,
  type SaveStepPayload,
  TIER_TRUCK_LIMITS,
} from './onboarding.contracts.js';
import {
  type OnboardingProgressRow,
  onboardingProgress,
  tenantActivationEvents,
} from './onboarding.tables.js';

export interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Job statuses that mean the job has been dispatched at least once. */
const DISPATCHED_STATUSES = [
  'dispatched',
  'enroute',
  'on_scene',
  'in_progress',
  'completed',
] as const;

const COUNT = sql<number>`count(*)::int`;

@Injectable()
export class OnboardingService {
  constructor(private readonly db: TenantAwareDb) {}

  /** Full onboarding state: progress + recomputed activation ledger. */
  async getState(ctx: CallerContext): Promise<OnboardingStateDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await this.ensureRow(tx, ctx);
      await this.recompute(tx, ctx, row);
      return this.readState(tx, row);
    });
  }

  /** Idempotently re-observe real tenant state and emit any newly-true
   * milestones. Exposed so a client (e.g. the dashboard after a dispatch) can
   * nudge the ledger without loading the whole wizard. */
  async recomputeState(ctx: CallerContext): Promise<OnboardingStateDto> {
    return this.getState(ctx);
  }

  /** Persist a step's resumable form snapshot and (optionally) mark it done. */
  async saveStep(
    ctx: CallerContext,
    step: EditableStep,
    payload: SaveStepPayload,
  ): Promise<OnboardingStateDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await this.ensureRow(tx, ctx);
      if (row.completedAt) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Onboarding is already complete',
        });
      }

      const stepData = {
        ...(row.stepData as Record<string, unknown>),
        [step]: payload.data,
      };
      const stepsCompleted =
        payload.complete && !row.stepsCompleted.includes(step)
          ? [...row.stepsCompleted, step]
          : row.stepsCompleted;
      const currentStep = nextStepFrom(stepsCompleted, null) ?? row.currentStep;

      const [updated] = await tx
        .update(onboardingProgress)
        .set({ stepData, stepsCompleted, currentStep })
        .where(eq(onboardingProgress.id, row.id))
        .returning();
      const next = updated ?? row;

      if (step === 'company_info' && payload.complete) {
        await this.emit(tx, ctx, 'company_info_completed');
      }
      await this.recompute(tx, ctx, next);
      return this.readState(tx, next);
    });
  }

  /** Activate a pricing tier (self-serve → free). Enforces the truck cap. */
  async activateTier(
    ctx: CallerContext,
    payload: ActivateTierPayload,
  ): Promise<OnboardingStateDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await this.ensureRow(tx, ctx);
      const limit = TIER_TRUCK_LIMITS[payload.tier];
      if (limit !== null) {
        const truckCount = await this.countTrucks(tx);
        if (truckCount > limit) {
          throw new ConflictException({
            code: ERROR_CODES.CONFLICT,
            message: `The ${payload.tier} tier allows at most ${limit} truck${
              limit === 1 ? '' : 's'
            }; this account has ${truckCount}. Remove a truck or choose a higher tier.`,
          });
        }
      }

      const [updated] = await tx
        .update(onboardingProgress)
        .set({ tier: payload.tier })
        .where(eq(onboardingProgress.id, row.id))
        .returning();
      const next = updated ?? row;

      if (payload.tier === 'free') {
        await this.emit(tx, ctx, 'free_tier_activated');
      }
      await this.recompute(tx, ctx, next);
      return this.readState(tx, next);
    });
  }

  /** Finish the wizard. Requires company info at minimum. */
  async complete(ctx: CallerContext): Promise<OnboardingStateDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await this.ensureRow(tx, ctx);
      if (!row.stepsCompleted.includes('company_info')) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Complete the company info step before finishing onboarding',
        });
      }

      const [updated] = await tx
        .update(onboardingProgress)
        .set({ completedAt: new Date(), currentStep: 'completed' })
        .where(eq(onboardingProgress.id, row.id))
        .returning();
      const next = updated ?? row;

      await this.emit(tx, ctx, 'onboarding_completed');
      await this.recompute(tx, ctx, next);
      return this.readState(tx, next);
    });
  }

  // -------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------

  /** Get-or-create the single live progress row. Race-safe: a concurrent
   * first load loses the INSERT to ON CONFLICT DO NOTHING, then both SELECT
   * the same winning row. Emits account_created on creation. */
  private async ensureRow(tx: Tx, ctx: CallerContext): Promise<OnboardingProgressRow> {
    await tx
      .insert(onboardingProgress)
      .values({ id: uuidv7(), tenantId: ctx.tenantId, createdBy: ctx.userId })
      .onConflictDoNothing();
    await this.emit(tx, ctx, 'account_created');

    const [row] = await tx
      .select()
      .from(onboardingProgress)
      .where(
        and(eq(onboardingProgress.tenantId, ctx.tenantId), isNull(onboardingProgress.deletedAt)),
      )
      .limit(1);
    if (!row) {
      throw new Error('onboarding_progress row missing after get-or-create');
    }
    return row;
  }

  /** Observe real tenant state and emit any milestone that is now true. */
  private async recompute(tx: Tx, ctx: CallerContext, row: OnboardingProgressRow): Promise<void> {
    const [ownerVerified, invites, truckCount, driverCount, dispatchedJobs] = await Promise.all([
      this.scalar(
        tx
          .select({ c: COUNT })
          .from(users)
          .where(
            and(eq(users.role, 'owner'), isNotNull(users.emailVerifiedAt), isNull(users.deletedAt)),
          ),
      ),
      this.scalar(tx.select({ c: COUNT }).from(userInvites)),
      this.countTrucks(tx),
      this.scalar(tx.select({ c: COUNT }).from(drivers).where(isNull(drivers.deletedAt))),
      this.scalar(
        tx
          .select({ c: COUNT })
          .from(jobs)
          .where(and(isNull(jobs.deletedAt), inArray(jobs.status, [...DISPATCHED_STATUSES]))),
      ),
    ]);

    const truths: Array<[ActivationEventType, boolean]> = [
      ['account_created', true],
      ['email_verified', ownerVerified > 0],
      ['company_info_completed', row.stepsCompleted.includes('company_info')],
      ['first_user_invited', invites > 0],
      ['first_truck_added', truckCount > 0],
      ['first_driver_added', driverCount > 0],
      ['first_job_dispatched', dispatchedJobs > 0],
    ];

    for (const [type, on] of truths) {
      if (on) await this.emit(tx, ctx, type);
    }
  }

  private async emit(tx: Tx, ctx: CallerContext, eventType: ActivationEventType): Promise<void> {
    await tx
      .insert(tenantActivationEvents)
      .values({ id: uuidv7(), tenantId: ctx.tenantId, eventType, createdBy: ctx.userId })
      .onConflictDoNothing({
        target: [tenantActivationEvents.tenantId, tenantActivationEvents.eventType],
      });
  }

  private async readState(tx: Tx, row: OnboardingProgressRow): Promise<OnboardingStateDto> {
    const events = await tx
      .select({
        eventType: tenantActivationEvents.eventType,
        occurredAt: tenantActivationEvents.occurredAt,
      })
      .from(tenantActivationEvents)
      .where(eq(tenantActivationEvents.tenantId, row.tenantId))
      .orderBy(tenantActivationEvents.occurredAt);

    const present = new Set(events.map((e) => e.eventType));
    const milestones = Object.fromEntries(
      ACTIVATION_EVENTS.map((e) => [e, present.has(e)]),
    ) as Record<ActivationEventType, boolean>;

    return {
      progress: progressToDto(row),
      activation: events.map((e) => ({
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
      })),
      milestones,
      nextStep: nextStepFrom(row.stepsCompleted, row.completedAt),
      truckLimit: TIER_TRUCK_LIMITS[row.tier],
    };
  }

  private async countTrucks(tx: Tx): Promise<number> {
    return this.scalar(tx.select({ c: COUNT }).from(trucks).where(isNull(trucks.deletedAt)));
  }

  private async scalar(qb: PromiseLike<Array<{ c: number }>>): Promise<number> {
    const rows = await qb;
    return rows[0]?.c ?? 0;
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

/** First incomplete editable step, then `activate`, then null once finished. */
export function nextStepFrom(
  stepsCompleted: readonly OnboardingStep[],
  completedAt: Date | null,
): OnboardingStep | null {
  if (completedAt) return null;
  for (const s of EDITABLE_STEPS) {
    if (!stepsCompleted.includes(s)) return s;
  }
  return 'activate';
}

function progressToDto(row: OnboardingProgressRow): OnboardingProgressDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    currentStep: row.currentStep,
    stepsCompleted: row.stepsCompleted,
    stepData: row.stepData as Record<string, unknown>,
    tier: row.tier,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
