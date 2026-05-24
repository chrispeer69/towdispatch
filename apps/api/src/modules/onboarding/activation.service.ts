/**
 * ActivationService — the tenant_activation_events ledger.
 *
 * Two responsibilities:
 *   1. emit() — idempotent insert of a single milestone. Relies on the
 *      (tenant_id, event_type) unique index + onConflictDoNothing so callers
 *      can fire it freely without checking first.
 *   2. refreshDerived() — observes real tenant state (verified users, truck /
 *      driver / dispatched-job counts, invites) and lazily emits the derived
 *      milestones. This is how "first job dispatched" is tracked without
 *      modifying the jobs/dispatch modules (session scope keeps those
 *      untouched): we read, we don't hook.
 *
 * All work runs inside the tenant RLS context, so every read/write is
 * confined to the caller's tenant.
 */
import { Injectable } from '@nestjs/common';
import {
  type ActivationEventType,
  drivers,
  jobs,
  tenantActivationEvents,
  trucks,
  userInvites,
  users,
  uuidv7,
} from '@ustowdispatch/db';
import type { ActivationEventDto, OnboardingChecklist } from '@ustowdispatch/shared';
import { and, count, inArray, isNotNull, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { type CallerContext, toTenantContext } from './caller-context.js';

/** Job statuses that mean a job has been dispatched (or progressed beyond). */
const DISPATCHED_JOB_STATUSES = [
  'dispatched',
  'enroute',
  'on_scene',
  'in_progress',
  'completed',
] as const;

@Injectable()
export class ActivationService {
  constructor(private readonly db: TenantAwareDb) {}

  /** Idempotent single-milestone emit. */
  async emit(
    ctx: CallerContext,
    eventType: ActivationEventType,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      await this.emitInTx(tx, ctx, eventType, metadata);
    });
  }

  private async emitInTx(
    tx: Tx,
    ctx: CallerContext,
    eventType: ActivationEventType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx
      .insert(tenantActivationEvents)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        eventType,
        metadata,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing({
        target: [tenantActivationEvents.tenantId, tenantActivationEvents.eventType],
      });
  }

  /** All activation events for the tenant, oldest first. */
  async list(ctx: CallerContext): Promise<ActivationEventDto[]> {
    return this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      const rows = await tx.query.tenantActivationEvents.findMany({
        orderBy: (t, { asc }) => [asc(t.occurredAt)],
      });
      return rows.map((r) => ({
        eventType: r.eventType,
        occurredAt: r.occurredAt.toISOString(),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      }));
    });
  }

  /**
   * Reads real tenant state and emits any derived milestone that is newly
   * true, then returns the resulting checklist. Idempotent — safe to call on
   * every GET /onboarding/progress.
   */
  async refreshDerivedAndBuildChecklist(ctx: CallerContext): Promise<OnboardingChecklist> {
    return this.db.runInTenantContext(toTenantContext(ctx), async (tx) => {
      const [verifiedUsers] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(isNull(users.deletedAt), isNotNull(users.emailVerifiedAt)));

      const [truckCount] = await tx
        .select({ n: count() })
        .from(trucks)
        .where(isNull(trucks.deletedAt));

      const [driverCount] = await tx
        .select({ n: count() })
        .from(drivers)
        .where(isNull(drivers.deletedAt));

      const [inviteCount] = await tx.select({ n: count() }).from(userInvites);

      const [dispatchedJobs] = await tx
        .select({ n: count() })
        .from(jobs)
        .where(and(isNull(jobs.deletedAt), inArray(jobs.status, [...DISPATCHED_JOB_STATUSES])));

      const existing = await tx.query.tenantActivationEvents.findMany({
        columns: { eventType: true },
      });
      const seen = new Set<ActivationEventType>(existing.map((e) => e.eventType));

      const emailVerified = (verifiedUsers?.n ?? 0) > 0;
      const firstTruckAdded = (truckCount?.n ?? 0) > 0;
      const firstDriverAdded = (driverCount?.n ?? 0) > 0;
      const firstUserInvited = (inviteCount?.n ?? 0) > 0;
      const firstJobDispatched = (dispatchedJobs?.n ?? 0) > 0;

      const toEmit: ActivationEventType[] = [];
      if (emailVerified && !seen.has('email_verified')) toEmit.push('email_verified');
      if (firstTruckAdded && !seen.has('first_truck_added')) toEmit.push('first_truck_added');
      if (firstDriverAdded && !seen.has('first_driver_added')) toEmit.push('first_driver_added');
      if (firstUserInvited && !seen.has('first_user_invited')) toEmit.push('first_user_invited');
      if (firstJobDispatched && !seen.has('first_job_dispatched')) {
        toEmit.push('first_job_dispatched');
      }
      for (const eventType of toEmit) {
        await this.emitInTx(tx, ctx, eventType, { source: 'derived' });
      }

      return {
        accountCreated: seen.has('account_created'),
        emailVerified,
        companyInfoCompleted: seen.has('company_info_completed'),
        firstUserInvited,
        firstTruckAdded,
        firstDriverAdded,
        firstJobDispatched,
      };
    });
  }
}
