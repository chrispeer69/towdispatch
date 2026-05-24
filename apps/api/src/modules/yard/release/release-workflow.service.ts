/**
 * ReleaseWorkflowService — the gated vehicle-release wizard (Yard
 * Management, Session 54). Each step is gated by the pure
 * evaluateReleaseTransition; re-calling a satisfied step returns the current
 * row (idempotent), never an error. On gate release it frees the stall,
 * closes the S22 impound record (released_at + status), and emits
 * impound.released for downstream (Public API webhook fan-out).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { impoundRecords, releaseWorkflows, uuidv7, yardStalls } from '@ustowdispatch/db';
import {
  type AuthorizeLienholderPayload,
  type CancelReleasePayload,
  type CollectReleasePaymentPayload,
  DISPATCH_EVENTS,
  type ReleaseWorkflowDto,
  type VerifyReleaseIdPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { DispatchEventsService } from '../../dispatch/dispatch-events.service.js';
import type { CallerCtx } from '../yard-facility.service.js';
import { type ReleaseState, evaluateReleaseTransition } from './release-workflow.logic.js';

type WorkflowRow = typeof releaseWorkflows.$inferSelect;

@Injectable()
export class ReleaseWorkflowService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly events: DispatchEventsService,
  ) {}

  async getForImpound(ctx: CallerCtx, impoundId: string): Promise<ReleaseWorkflowDto | null> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.releaseWorkflows.findFirst({
        where: and(
          eq(releaseWorkflows.impoundId, impoundId),
          ne(releaseWorkflows.status, 'cancelled'),
        ),
      });
      return row ? toWorkflowDto(row) : null;
    });
  }

  async initiate(ctx: CallerCtx, impoundId: string): Promise<ReleaseWorkflowDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, impoundId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found in this tenant');
      // Idempotent: a live workflow already exists → return it.
      const existing = await tx.query.releaseWorkflows.findFirst({
        where: and(
          eq(releaseWorkflows.impoundId, impoundId),
          ne(releaseWorkflows.status, 'cancelled'),
        ),
      });
      if (existing) return toWorkflowDto(existing);
      const [row] = await tx
        .insert(releaseWorkflows)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          impoundId,
          status: 'initiated',
          initiatedByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('initiate: insert returning() yielded no row');
      return toWorkflowDto(row);
    });
  }

  async verifyId(
    ctx: CallerCtx,
    workflowId: string,
    input: VerifyReleaseIdPayload,
  ): Promise<ReleaseWorkflowDto> {
    return this.step(ctx, workflowId, 'verify_id', (wf) => wf.payerIdLast4 !== null, {
      status: 'id_verified',
      payerName: input.payerName,
      payerIdType: input.payerIdType,
      payerIdLast4: input.payerIdLast4,
    });
  }

  async authorizeLienholder(
    ctx: CallerCtx,
    workflowId: string,
    input: AuthorizeLienholderPayload,
  ): Promise<ReleaseWorkflowDto> {
    return this.step(
      ctx,
      workflowId,
      'authorize_lienholder',
      (wf) => wf.lienholderAuthRef !== null,
      { status: 'lienholder_authorized', lienholderAuthRef: input.lienholderAuthRef },
    );
  }

  async collectPayment(
    ctx: CallerCtx,
    workflowId: string,
    input: CollectReleasePaymentPayload,
  ): Promise<ReleaseWorkflowDto> {
    return this.step(ctx, workflowId, 'collect_payment', (wf) => wf.paymentAmountCents !== null, {
      status: 'payment_collected',
      paymentAmountCents: input.paymentAmountCents,
      paymentMethod: input.paymentMethod,
    });
  }

  async cancel(
    ctx: CallerCtx,
    workflowId: string,
    input: CancelReleasePayload,
  ): Promise<ReleaseWorkflowDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const wf = await loadWorkflow(tx, workflowId);
      if (wf.status === 'cancelled') return toWorkflowDto(wf); // idempotent
      const check = evaluateReleaseTransition(stateOf(wf), 'cancel');
      if (!check.allowed) throw blocked(check.reason);
      const now = new Date();
      const [row] = await tx
        .update(releaseWorkflows)
        .set({ status: 'cancelled', cancelledAt: now, cancelReason: input.reason, updatedAt: now })
        .where(eq(releaseWorkflows.id, workflowId))
        .returning();
      if (!row) throw notFound('Release workflow not found');
      return toWorkflowDto(row);
    });
  }

  async gateRelease(ctx: CallerCtx, workflowId: string): Promise<ReleaseWorkflowDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const wf = await loadWorkflow(tx, workflowId);
      if (wf.status === 'gate_released') return toWorkflowDto(wf); // idempotent
      const check = evaluateReleaseTransition(stateOf(wf), 'gate_release');
      if (!check.allowed) throw blocked(check.reason);

      const now = new Date();
      const [row] = await tx
        .update(releaseWorkflows)
        .set({
          status: 'gate_released',
          gateReleasedByUserId: ctx.userId,
          gateReleasedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(releaseWorkflows.id, workflowId))
        .returning();
      if (!row) throw notFound('Release workflow not found');

      // Free the stall holding this vehicle.
      await tx
        .update(yardStalls)
        .set({ occupiedByImpoundId: null, occupiedSince: null, updatedAt: now })
        .where(and(eq(yardStalls.occupiedByImpoundId, wf.impoundId), isNull(yardStalls.deletedAt)));

      // Close the S22 impound record (additive integration: set released_at +
      // status when it is still in a storage state).
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, wf.impoundId), isNull(impoundRecords.deletedAt)),
      });
      if (record && (record.status === 'stored' || record.status === 'pending_release')) {
        await tx
          .update(impoundRecords)
          .set({ status: 'released', releasedAt: now, updatedAt: now })
          .where(eq(impoundRecords.id, wf.impoundId));
      }

      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.IMPOUND_RELEASED, {
        impoundRecordId: wf.impoundId,
        releasedToName: row.payerName ?? 'Unknown',
        releasedToType: 'owner',
        totalFeesCents: row.paymentAmountCents ?? 0,
        releasedAt: now.toISOString(),
      });

      return toWorkflowDto(row);
    });
  }

  /** Shared step runner: idempotency check, gate, patch + status advance. */
  private async step(
    ctx: CallerCtx,
    workflowId: string,
    action: Parameters<typeof evaluateReleaseTransition>[1],
    alreadyDone: (wf: WorkflowRow) => boolean,
    patch: Partial<typeof releaseWorkflows.$inferInsert>,
  ): Promise<ReleaseWorkflowDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const wf = await loadWorkflow(tx, workflowId);
      if (alreadyDone(wf) && wf.status !== 'cancelled' && wf.status !== 'gate_released') {
        return toWorkflowDto(wf); // idempotent re-call
      }
      const check = evaluateReleaseTransition(stateOf(wf), action);
      if (!check.allowed) throw blocked(check.reason);
      const [row] = await tx
        .update(releaseWorkflows)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(releaseWorkflows.id, workflowId))
        .returning();
      if (!row) throw notFound('Release workflow not found');
      return toWorkflowDto(row);
    });
  }
}

async function loadWorkflow(
  tx: Parameters<Parameters<TenantAwareDb['runInTenantContext']>[1]>[0],
  workflowId: string,
): Promise<WorkflowRow> {
  const wf = await tx.query.releaseWorkflows.findFirst({
    where: eq(releaseWorkflows.id, workflowId),
  });
  if (!wf) throw notFound('Release workflow not found');
  return wf;
}

function stateOf(wf: WorkflowRow): ReleaseState {
  return {
    status: wf.status,
    hasIdVerified: wf.payerIdLast4 !== null,
    hasLienholderAuth: wf.lienholderAuthRef !== null,
    hasPayment: wf.paymentAmountCents !== null,
  };
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function blocked(reason: string | null): ConflictException {
  return new ConflictException({
    code: 'RELEASE_BLOCKED',
    message: reason ?? 'Transition blocked.',
  });
}

export function toWorkflowDto(row: WorkflowRow): ReleaseWorkflowDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    impoundId: row.impoundId,
    status: row.status,
    initiatedAt: row.initiatedAt.toISOString(),
    initiatedByUserId: row.initiatedByUserId,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    payerName: row.payerName,
    payerIdType: row.payerIdType,
    payerIdLast4: row.payerIdLast4,
    lienholderAuthRef: row.lienholderAuthRef,
    paymentAmountCents: row.paymentAmountCents,
    paymentMethod: row.paymentMethod,
    gateReleasedByUserId: row.gateReleasedByUserId,
    gateReleasedAt: row.gateReleasedAt ? row.gateReleasedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
