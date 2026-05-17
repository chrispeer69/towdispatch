/**
 * SaveWorkflowService — quote-decline save funnel (Moat #8).
 *
 * State machine:
 *   decline (with reason) → save_step_1 → save_step_2 → save_step_counter → save_step_manager_call
 *
 * Each "step" event is appended to `quote_save_workflow_events`. The
 * service enforces ordering: you cannot accept step 2 without step 1
 * having been declined first.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { jobs, quoteSaveWorkflowEvents, uuidv7 } from '@ustowdispatch/db';
import {
  type DeclineQuotePayload,
  type QuoteSaveWorkflowEventDto,
  type QuoteSaveWorkflowStep,
  SAVE_STEP_DISCOUNT_PCT,
  SAVE_STEP_NEXT,
  type SaveStepResponsePayload,
} from '@ustowdispatch/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class SaveWorkflowService {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Customer declined the original quote. Open the funnel by recording
   * an offer of step 1 (5% off). Returns the offered amount + the next
   * step's expected response shape.
   */
  async declineAndOpenStep1(
    ctx: CallerCtx,
    jobId: string,
    payload: DeclineQuotePayload,
  ): Promise<{
    offeredStep: QuoteSaveWorkflowStep;
    discountPct: number | null;
    offeredPriceCents: number;
    declineReasonCode: string;
  }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Job not found' });
      const existing = await tx.query.quoteSaveWorkflowEvents.findFirst({
        where: eq(quoteSaveWorkflowEvents.jobId, jobId),
      });
      if (existing) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Save workflow already opened for this job',
        });
      }
      const discountPct = SAVE_STEP_DISCOUNT_PCT.save_step_1 ?? 0;
      const offeredPriceCents = Math.round(
        Number(job.rateQuotedCents) * (1 - discountPct / 100),
      );
      // Step 1 is recorded as "offered" — accepted=false until customer
      // takes it.
      await tx.insert(quoteSaveWorkflowEvents).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        step: 'save_step_1',
        discountPct: discountPct.toString(),
        accepted: false,
        declineReasonCode: payload.declineReasonCode,
        recordedByUserId: ctx.userId,
      });
      return {
        offeredStep: 'save_step_1',
        discountPct,
        offeredPriceCents,
        declineReasonCode: payload.declineReasonCode,
      };
    });
  }

  /**
   * Operator records the customer's response to the currently-offered
   * step. If accepted=true, the funnel ends and (for steps 1/2) the
   * job's rate_quoted_cents is updated to the discounted amount; (for
   * counter) it's the operator-typed price.
   *
   * If accepted=false, the next step is auto-offered; final step
   * (manager_call) is recorded as the terminal node.
   */
  async respondToCurrentStep(
    ctx: CallerCtx,
    jobId: string,
    payload: SaveStepResponsePayload,
  ): Promise<{ done: boolean; nextStep: QuoteSaveWorkflowStep | null }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Job not found' });
      const events = await tx.query.quoteSaveWorkflowEvents.findMany({
        where: eq(quoteSaveWorkflowEvents.jobId, jobId),
        orderBy: [asc(quoteSaveWorkflowEvents.createdAt)],
      });
      if (events.length === 0) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'No save workflow open for this job; call decline first',
        });
      }
      const last = events[events.length - 1];
      if (!last) throw new Error('respondToCurrentStep: events array empty after non-zero check');
      if (last.accepted) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Save workflow already concluded',
        });
      }
      const currentStep = last.step as QuoteSaveWorkflowStep;
      const declineReason = payload.declineReasonCode ?? last.declineReasonCode;

      if (payload.accepted) {
        // Customer took the offer. Mark the in-flight event accepted and
        // move the job's rate_quoted_cents accordingly.
        const newPrice = await this.computeAcceptedPrice(
          currentStep,
          Number(job.rateQuotedCents),
          payload.customPriceCents,
          last.discountPct ? Number(last.discountPct) : null,
        );
        await tx
          .update(quoteSaveWorkflowEvents)
          .set({ accepted: true, customPriceCents: newPrice })
          .where(eq(quoteSaveWorkflowEvents.id, last.id));
        await tx
          .update(jobs)
          .set({ rateQuotedCents: newPrice, updatedAt: new Date() })
          .where(eq(jobs.id, jobId));
        return { done: true, nextStep: null };
      }

      // Customer declined this step. If there is a next step, offer it.
      const next = SAVE_STEP_NEXT[currentStep];
      if (!next) {
        // Final step rejected — workflow closes with no save.
        return { done: true, nextStep: null };
      }
      const nextDiscount = SAVE_STEP_DISCOUNT_PCT[next];
      await tx.insert(quoteSaveWorkflowEvents).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        step: next,
        discountPct: nextDiscount !== null ? nextDiscount.toString() : null,
        accepted: false,
        declineReasonCode: declineReason ?? null,
        recordedByUserId: ctx.userId,
      });
      return { done: false, nextStep: next };
    });
  }

  async listForJob(ctx: CallerCtx, jobId: string): Promise<QuoteSaveWorkflowEventDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const events = await tx.query.quoteSaveWorkflowEvents.findMany({
        where: eq(quoteSaveWorkflowEvents.jobId, jobId),
        orderBy: [asc(quoteSaveWorkflowEvents.createdAt)],
      });
      return events.map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        jobId: e.jobId,
        step: e.step,
        discountPct: e.discountPct ? Number(e.discountPct) : null,
        customPriceCents: e.customPriceCents ? Number(e.customPriceCents) : null,
        declineReasonCode: e.declineReasonCode,
        accepted: e.accepted,
        recordedByUserId: e.recordedByUserId,
        createdAt: e.createdAt.toISOString(),
      }));
    });
  }

  private async computeAcceptedPrice(
    step: QuoteSaveWorkflowStep,
    originalCents: number,
    customCents: number | undefined,
    discountPct: number | null,
  ): Promise<number> {
    if (step === 'save_step_counter') {
      if (typeof customCents !== 'number') {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'save_step_counter requires customPriceCents',
        });
      }
      return Math.round(customCents);
    }
    if (step === 'save_step_manager_call') {
      // Manager-call accepted means the manager handles it offline; we
      // keep the original price in the data model and mark the funnel
      // closed.
      return originalCents;
    }
    const pct = discountPct ?? SAVE_STEP_DISCOUNT_PCT[step] ?? 0;
    return Math.round(originalCents * (1 - pct / 100));
  }

  private toTenantCtx(ctx: CallerCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
  }
}
