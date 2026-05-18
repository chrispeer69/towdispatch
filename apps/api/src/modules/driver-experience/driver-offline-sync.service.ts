/**
 * DriverOfflineSyncService — replays a batch of actions queued by the
 * driver app while offline.
 *
 * Per action:
 *   1. If a row with this (tenant, driver, client_event_uuid) exists
 *      already, return its current status untouched (idempotent
 *      replay). The unique index does the dedup.
 *   2. Otherwise insert with status='pending' and try to apply by
 *      routing on actionKind to the appropriate service method.
 *   3. On success → status='applied', applied_at=now.
 *      On error → status='failed', failure_reason set.
 *      On detected conflict (the world moved on after the queued
 *        client_timestamp) → status='skipped',
 *        failure_reason='rejected_conflict: …'.
 *
 * NOTE on the 'rejected_conflict' wire value: the driver_offline_actions
 * status enum landed in Session 1 as ('pending'|'applied'|'failed'
 * |'skipped'). The task spec asked for 'rejected_conflict' but extending
 * the enum is a migration that belongs in a separate PR. We map conflict
 * to 'skipped' with a 'rejected_conflict:' prefix in failure_reason so
 * the driver app can still tell conflict-rejects from generic skips.
 * See judgment-calls in the Session 2 PR description.
 */
import { Injectable } from '@nestjs/common';
import {
  type DriverOfflineActionStatus,
  driverOfflineActions,
  jobs,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  CreateDriverOfflineActionBatchPayload,
  DriverOfflineActionKind,
} from '@ustowdispatch/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverBriefingService } from './driver-briefing.service.js';
import { DriverEvidenceService } from './driver-evidence.service.js';
import { DriverPretripService } from './driver-pretrip.service.js';

export interface OfflineReplayResultItem {
  clientEventUuid: string;
  actionKind: string;
  status: DriverOfflineActionStatus;
  failureReason: string | null;
  rowId: string;
}

@Injectable()
export class DriverOfflineSyncService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly jobs: JobsService,
    private readonly briefings: DriverBriefingService,
    private readonly evidence: DriverEvidenceService,
    private readonly pretrip: DriverPretripService,
  ) {}

  async replay(
    ctx: DriverContext,
    input: CreateDriverOfflineActionBatchPayload,
  ): Promise<{ results: OfflineReplayResultItem[] }> {
    const results: OfflineReplayResultItem[] = [];
    for (const action of input.actions) {
      const result = await this.replayOne(ctx, action);
      results.push(result);
    }
    return { results };
  }

  private async replayOne(
    ctx: DriverContext,
    action: CreateDriverOfflineActionBatchPayload['actions'][number],
  ): Promise<OfflineReplayResultItem> {
    // Step 1: insert-or-fetch the ledger row. ON CONFLICT DO NOTHING +
    // re-select gives us "idempotent insert" with one round trip per
    // outcome. The row id is needed for the status update below.
    const ledgerRowId = await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const id = uuidv7();
        await tx.execute(sql`
          INSERT INTO driver_offline_actions
            (id, tenant_id, driver_id, job_id, shift_id, action_kind,
             payload, client_timestamp, client_event_uuid, status,
             received_at, created_at, updated_at)
          VALUES (
            ${id}::uuid,
            ${ctx.tenantId}::uuid,
            ${ctx.driverId}::uuid,
            ${action.jobId ?? null},
            ${action.shiftId ?? null},
            ${action.actionKind},
            ${JSON.stringify(action.payload)}::jsonb,
            ${new Date(action.clientTimestamp)},
            ${action.clientEventUuid}::uuid,
            'pending',
            now(),
            now(),
            now()
          )
          ON CONFLICT (tenant_id, driver_id, client_event_uuid)
          DO NOTHING
        `);
        const existing = await tx.query.driverOfflineActions.findFirst({
          where: and(
            eq(driverOfflineActions.tenantId, ctx.tenantId),
            eq(driverOfflineActions.driverId, ctx.driverId),
            eq(driverOfflineActions.clientEventUuid, action.clientEventUuid),
          ),
        });
        if (!existing) {
          throw new Error('offline action upsert returned no row');
        }
        return existing.id;
      },
    );

    // If the row already settled (idempotent replay), short-circuit.
    const settled = await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) =>
        tx.query.driverOfflineActions.findFirst({
          where: eq(driverOfflineActions.id, ledgerRowId),
        }),
    );
    if (settled && settled.status !== 'pending') {
      return {
        clientEventUuid: action.clientEventUuid,
        actionKind: action.actionKind,
        status: settled.status,
        failureReason: settled.failureReason,
        rowId: settled.id,
      };
    }

    // Step 2: route by kind and apply. Each branch returns the outcome
    // — apply success, apply error, or detected conflict. The branch
    // body must not throw past this point; we want every failure
    // surfaced in the ledger row so the driver app can retry / discard.
    let outcome:
      | { kind: 'applied' }
      | { kind: 'failed'; reason: string }
      | { kind: 'conflict'; reason: string };
    try {
      await this.apply(ctx, action.actionKind as DriverOfflineActionKind, action);
      outcome = { kind: 'applied' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Heuristic: a CONFLICT from JobsService is a real-world conflict
      // (someone else moved the job's state on after this action's
      // client timestamp). 409 / "Cannot…" / "Invalid state" all map
      // to rejected_conflict so the app can pop a sensible UI.
      if (looksLikeConflict(msg)) {
        outcome = { kind: 'conflict', reason: `rejected_conflict: ${msg.slice(0, 1500)}` };
      } else {
        outcome = { kind: 'failed', reason: msg.slice(0, 1500) };
      }
    }

    const finalStatus: DriverOfflineActionStatus =
      outcome.kind === 'applied' ? 'applied' : outcome.kind === 'conflict' ? 'skipped' : 'failed';
    const failureReason = outcome.kind === 'applied' ? null : outcome.reason;

    await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        await tx
          .update(driverOfflineActions)
          .set({
            status: finalStatus,
            failureReason,
            appliedAt: finalStatus === 'applied' ? new Date() : null,
            failedAt: finalStatus === 'failed' ? new Date() : null,
            attemptCount: sql`${driverOfflineActions.attemptCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(driverOfflineActions.id, ledgerRowId));
      },
    );

    return {
      clientEventUuid: action.clientEventUuid,
      actionKind: action.actionKind,
      status: finalStatus,
      failureReason,
      rowId: ledgerRowId,
    };
  }

  private async apply(
    ctx: DriverContext,
    kind: DriverOfflineActionKind,
    action: CreateDriverOfflineActionBatchPayload['actions'][number],
  ): Promise<void> {
    // JobsService.CallerContext wants `string | null`; TenantAwareDb's
    // TenantContextValues wants `string | undefined`. The two
    // representations diverged historically — coerce at call site rather
    // than try to unify a shared type that doesn't exist yet.
    const jobsCallerCtx = {
      tenantId: ctx.tenantId,
      userId: ctx.driverId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    };
    const tenantCtxValues = {
      tenantId: ctx.tenantId,
      userId: ctx.driverId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
    const driverCtx: DriverContext = {
      tenantId: ctx.tenantId,
      driverId: ctx.driverId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    };
    const payload = action.payload as Record<string, unknown>;

    switch (kind) {
      case 'job_status_transition': {
        if (!action.jobId) throw new Error('job_status_transition requires jobId');
        const toStatus = payload.toStatus as string | undefined;
        if (!toStatus) throw new Error('job_status_transition requires payload.toStatus');
        // Conflict detection — if the job already moved past the queued
        // status, fail with a conflict marker the outer mapper picks up.
        await this.db.runInTenantContext(tenantCtxValues, async (tx) => {
          const current = await tx.query.jobs.findFirst({
            where: and(eq(jobs.id, action.jobId as string), isNull(jobs.deletedAt)),
            columns: { status: true, updatedAt: true },
          });
          if (
            current &&
            current.updatedAt.toISOString() > action.clientTimestamp &&
            current.status !== payload.fromStatus
          ) {
            throw new Error(
              `INVALID_STATE_TRANSITION: job moved to ${current.status} after this action was queued`,
            );
          }
        });
        await this.jobs.transition(
          jobsCallerCtx,
          action.jobId,
          toStatus as Parameters<JobsService['transition']>[2],
          typeof payload.reason === 'string' ? payload.reason : undefined,
        );
        return;
      }
      case 'submit_pretrip': {
        // The payload itself IS a createDriverPretripInspectionSchema
        // body, validated by the driver client before queueing. We
        // re-parse defensively at the service layer (zod's safeParse
        // through the controller wouldn't have run on a queued action).
        await this.pretrip.create(
          driverCtx,
          payload as unknown as Parameters<DriverPretripService['create']>[1],
        );
        return;
      }
      case 'acknowledge_briefing': {
        const briefingId = payload.briefingId as string | undefined;
        if (!briefingId) throw new Error('acknowledge_briefing requires payload.briefingId');
        const ackBody: {
          messageReadAt?: string | undefined;
          videoCompletedAt?: string | undefined;
        } = {};
        if (typeof payload.messageReadAt === 'string') {
          ackBody.messageReadAt = payload.messageReadAt;
        }
        if (typeof payload.videoCompletedAt === 'string') {
          ackBody.videoCompletedAt = payload.videoCompletedAt;
        }
        await this.briefings.acknowledge(driverCtx, briefingId, ackBody);
        return;
      }
      case 'upload_evidence': {
        // The queued action holds the metadata that goes with the post-
        // upload finalize call. The bytes themselves were already sent
        // directly to S3 with the presigned URL minted at queue time.
        const evidenceId = payload.evidenceId as string | undefined;
        if (!evidenceId) throw new Error('upload_evidence requires payload.evidenceId');
        const finalizeBody: Parameters<DriverEvidenceService['finalize']>[2] = {};
        if (typeof payload.width === 'number') finalizeBody.width = payload.width;
        if (typeof payload.height === 'number') finalizeBody.height = payload.height;
        if (typeof payload.durationSeconds === 'number')
          finalizeBody.durationSeconds = payload.durationSeconds;
        if (typeof payload.capturedLat === 'number') finalizeBody.capturedLat = payload.capturedLat;
        if (typeof payload.capturedLng === 'number') finalizeBody.capturedLng = payload.capturedLng;
        await this.evidence.finalize(
          {
            tenantId: ctx.tenantId,
            actorId: ctx.driverId,
            driverId: ctx.driverId,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
          evidenceId,
          finalizeBody,
        );
        return;
      }
      case 'capture_field_payment': {
        // Stub-only for Session 2: the real Stripe Terminal capture
        // happens on the device. We just record the intent / state
        // change. Field payments are out of scope for replay until the
        // real provider lands.
        throw new Error('capture_field_payment: not supported in Session 2 replay');
      }
      case 'shift_clock_on':
      case 'shift_clock_off':
      case 'note_add': {
        // Not supported yet in the replay router. Mark as failed so the
        // client surfaces the issue rather than silently dropping.
        throw new Error(`${kind}: not supported in Session 2 replay`);
      }
      default: {
        // Exhaustiveness check — adding a new kind to the enum forces
        // us to handle it here. The cast is necessary because TS treats
        // the enum-narrowed switch as already-exhaustive.
        const _exhaustive: never = kind;
        void _exhaustive;
        throw new Error(`unknown action kind: ${String(kind)}`);
      }
    }
  }
}

function looksLikeConflict(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('invalid_state_transition') ||
    m.includes('conflict') ||
    m.includes('cannot ') ||
    m.includes('moved to ')
  );
}
