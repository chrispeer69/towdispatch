/**
 * LienProcessingService — Lien Processing (Session 23).
 *
 * Operator-side orchestration of the statutory lien-sale workflow:
 *   - cases    : open / list / detail / update / advance / close
 *   - notices  : record an issued notice + record a response/claim
 *   - timeline : append-only audit of every case event
 *
 * Every method runs inside `runInTenantContext` so RLS isolates tenants.
 * All legal DECISIONS (which day-count applies, what's next, whether the
 * waiting period elapsed) live in the pure engine lien-rules.logic.ts; this
 * service is data access + transaction boundaries + step transitions. The
 * service NEVER decides to sell — that is always an explicit operator action
 * (closeCase with disposition 'sold', gated on status ready_for_sale).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  impoundRecords,
  impoundYards,
  lienCases,
  lienNotices,
  lienTimelineEvents,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  AdvanceLienCasePayload,
  CloseLienCasePayload,
  LienCaseDetailDto,
  LienCaseDto,
  LienCaseStep,
  LienImpoundSummary,
  LienNoticeDto,
  LienNoticeType,
  LienState,
  LienStateRulesDto,
  LienTimelineEventDto,
  LienTimelineEventType,
  ListLienCasesFilter,
  OpenLienCasePayload,
  RecordLienNoticePayload,
  RecordLienResponsePayload,
  UpdateLienCasePayload,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import {
  type ComputedNextAction,
  type LienCaseFacts,
  computeNextAction,
  computeValueTier,
} from './lien-rules.logic.js';
import { LIEN_STATE_RULES, getStateRules } from './state-rules.config.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

// Forward-only ordering of the workflow steps. recordNotice / advanceCase
// only ever move a case forward, never regress it.
const STEP_RANK: Record<LienCaseStep, number> = {
  opened: 0,
  dmv_lookup_requested: 1,
  dmv_lookup_complete: 2,
  owner_notice_sent: 3,
  lienholder_notice_sent: 4,
  publication_complete: 5,
  waiting_period: 6,
  ready_for_sale: 7,
  sold: 8,
  closed: 9,
};

@Injectable()
export class LienProcessingService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // State rules (global reference data)
  // ===================================================================

  listStateRules(): LienStateRulesDto[] {
    // Served from the typed config — the runtime source of truth. The DB
    // table mirrors it for queryability; the engine never depends on the row.
    const now = new Date().toISOString();
    return (Object.keys(LIEN_STATE_RULES) as LienState[]).map((state) => ({
      state,
      rules: LIEN_STATE_RULES[state],
      createdAt: now,
      updatedAt: now,
    }));
  }

  // ===================================================================
  // Cases
  // ===================================================================

  async openCase(ctx: CallerCtx, input: OpenLienCasePayload): Promise<LienCaseDetailDto> {
    const rules = getStateRules(input.state);
    if (!rules) {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: `Lien processing is not yet supported for ${input.state}.`,
      });
    }
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, input.impoundRecordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found in this tenant');

      const tier =
        input.vehicleValueTier ?? computeValueTier(input.estimatedValueCents ?? null, rules);

      const now = new Date();
      const id = uuidv7();
      const facts: LienCaseFacts = {
        state: input.state,
        status: 'open',
        currentStep: 'opened',
        valueTier: tier,
        ownerFound: input.ownerFound ?? false,
        lienholderFound: input.lienholderFound ?? false,
        openedAt: now,
        dmvLookupCompletedAt: null,
        ownerNoticeSentAt: null,
        lienholderNoticeSentAt: null,
        publicationCompletedAt: null,
        ownerResponseAt: null,
        lienholderResponseAt: null,
      };
      const next = computeNextAction(facts, rules, now);

      let row: typeof lienCases.$inferSelect | undefined;
      try {
        [row] = await tx
          .insert(lienCases)
          .values({
            id,
            tenantId: ctx.tenantId,
            impoundRecordId: input.impoundRecordId,
            state: input.state,
            status: 'open',
            currentStep: 'opened',
            vehicleValueTier: tier,
            ownerFound: input.ownerFound ?? false,
            lienholderFound: input.lienholderFound ?? false,
            estimatedValueCents: input.estimatedValueCents ?? null,
            openedAt: now,
            nextActionDueAt: next.dueAt,
            notes: input.notes ?? null,
            createdBy: ctx.userId,
          })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: 'A lien case is already open for this impound record.',
          });
        }
        throw err;
      }
      if (!row) throw new Error('openCase: insert returning() yielded no row');

      await this.addTimeline(tx, ctx, id, 'case_opened', {
        state: input.state,
        valueTier: tier,
        nextAction: next.action,
      });

      return this.buildDetail(tx, row);
    });
  }

  async listCases(ctx: CallerCtx, filter: ListLienCasesFilter): Promise<LienCaseDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(lienCases.deletedAt)];
      if (filter.state) clauses.push(eq(lienCases.state, filter.state));
      if (filter.status) clauses.push(eq(lienCases.status, filter.status));
      if (filter.step) clauses.push(eq(lienCases.currentStep, filter.step));
      if (filter.dueSoon === 'true') {
        clauses.push(eq(lienCases.status, 'open'));
        clauses.push(lte(lienCases.nextActionDueAt, new Date()));
      }
      const rows = await tx.query.lienCases.findMany({
        where: and(...clauses),
        orderBy: (t, { asc }) => [asc(t.nextActionDueAt), desc(t.openedAt)],
      });
      return rows.map(toCaseDto);
    });
  }

  async getCaseDetail(ctx: CallerCtx, caseId: string): Promise<LienCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await this.requireCase(tx, caseId);
      return this.buildDetail(tx, row);
    });
  }

  async updateCase(
    ctx: CallerCtx,
    caseId: string,
    input: UpdateLienCasePayload,
  ): Promise<LienCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      assertOpen(existing.status);
      const rules = requireRules(existing.state);

      const patch: Partial<typeof lienCases.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.ownerFound !== undefined) patch.ownerFound = input.ownerFound;
      if (input.lienholderFound !== undefined) patch.lienholderFound = input.lienholderFound;
      if (input.estimatedValueCents !== undefined) {
        patch.estimatedValueCents = input.estimatedValueCents ?? null;
      }
      // Tier: explicit wins; otherwise recompute from a newly-supplied value.
      let tierChanged = false;
      if (input.vehicleValueTier !== undefined) {
        patch.vehicleValueTier = input.vehicleValueTier;
        tierChanged = input.vehicleValueTier !== existing.vehicleValueTier;
      } else if (input.estimatedValueCents !== undefined && input.estimatedValueCents !== null) {
        const tier = computeValueTier(input.estimatedValueCents, rules);
        patch.vehicleValueTier = tier;
        tierChanged = tier !== existing.vehicleValueTier;
      }

      const [row] = await tx
        .update(lienCases)
        .set(patch)
        .where(and(eq(lienCases.id, caseId), isNull(lienCases.deletedAt)))
        .returning();
      if (!row) throw notFound('Lien case not found');

      await this.recomputeDue(tx, row);
      if (tierChanged) {
        await this.addTimeline(tx, ctx, caseId, 'value_tier_set', {
          valueTier: row.vehicleValueTier,
        });
      }
      const fresh = await this.requireCase(tx, caseId);
      return this.buildDetail(tx, fresh);
    });
  }

  async advanceCase(
    ctx: CallerCtx,
    caseId: string,
    input: AdvanceLienCasePayload,
  ): Promise<LienCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      assertOpen(existing.status);
      const rules = requireRules(existing.state);

      // Apply any DMV-result fields carried on the advance payload first.
      const patch: Partial<typeof lienCases.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.ownerFound !== undefined) patch.ownerFound = input.ownerFound;
      if (input.lienholderFound !== undefined) patch.lienholderFound = input.lienholderFound;
      if (input.estimatedValueCents !== undefined) {
        patch.estimatedValueCents = input.estimatedValueCents;
        if (input.vehicleValueTier === undefined) {
          patch.vehicleValueTier = computeValueTier(input.estimatedValueCents, rules);
        }
      }
      if (input.vehicleValueTier !== undefined) patch.vehicleValueTier = input.vehicleValueTier;

      const merged = { ...existing, ...patch } as typeof lienCases.$inferSelect;
      const notices = await this.loadNotices(tx, caseId);
      const facts = deriveFacts(merged, notices);
      const next = computeNextAction(facts, rules, new Date());

      const now = new Date();
      const target = nextStepFor(existing.currentStep, next);
      if (!target) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: blockingMessage(next),
          reasons: next.reasons,
        });
      }

      patch.currentStep = target.step;
      let eventType: LienTimelineEventType = 'step_advanced';
      if (target.step === 'dmv_lookup_complete') eventType = 'dmv_lookup_recorded';
      if (target.markReady) {
        patch.status = 'ready_for_sale';
        patch.readyForSaleAt = now;
        eventType = 'marked_ready_for_sale';
      }

      const [row] = await tx
        .update(lienCases)
        .set(patch)
        .where(and(eq(lienCases.id, caseId), isNull(lienCases.deletedAt)))
        .returning();
      if (!row) throw notFound('Lien case not found');

      await this.recomputeDue(tx, row);
      await this.addTimeline(tx, ctx, caseId, eventType, {
        fromStep: existing.currentStep,
        toStep: target.step,
      });
      const fresh = await this.requireCase(tx, caseId);
      return this.buildDetail(tx, fresh);
    });
  }

  async closeCase(
    ctx: CallerCtx,
    caseId: string,
    input: CloseLienCasePayload,
  ): Promise<LienCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      if (
        existing.status === 'sold' ||
        existing.status === 'closed' ||
        existing.status === 'canceled'
      ) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Lien case is already ${existing.status}.`,
        });
      }
      // A sale may only be recorded once the case is ready for sale — the
      // statutory prerequisites must have been satisfied first.
      if (input.disposition === 'sold' && existing.status !== 'ready_for_sale') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'A sale can only be recorded once the case is ready for sale.',
        });
      }

      const now = new Date();
      const patch: Partial<typeof lienCases.$inferInsert> & { updatedAt: Date } = {
        updatedAt: now,
        status: input.disposition,
        closedAt: now,
        closedReason: input.reason ?? null,
        nextActionDueAt: null,
      };
      if (input.disposition === 'sold') {
        patch.currentStep = 'sold';
        patch.soldAt = now;
      } else {
        patch.currentStep = 'closed';
      }

      const [row] = await tx
        .update(lienCases)
        .set(patch)
        .where(and(eq(lienCases.id, caseId), isNull(lienCases.deletedAt)))
        .returning();
      if (!row) throw notFound('Lien case not found');

      const eventType: LienTimelineEventType =
        input.disposition === 'sold'
          ? 'case_sold'
          : input.disposition === 'canceled'
            ? 'case_canceled'
            : 'case_closed';
      await this.addTimeline(tx, ctx, caseId, eventType, {
        disposition: input.disposition,
        reason: input.reason ?? null,
        salePriceCents: input.salePriceCents ?? null,
      });
      return this.buildDetail(tx, row);
    });
  }

  // ===================================================================
  // Notices
  // ===================================================================

  async recordNotice(
    ctx: CallerCtx,
    caseId: string,
    input: RecordLienNoticePayload,
  ): Promise<LienCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      assertOpen(existing.status);

      const id = uuidv7();
      try {
        await tx.insert(lienNotices).values({
          id,
          tenantId: ctx.tenantId,
          lienCaseId: caseId,
          noticeType: input.noticeType,
          recipientRole: input.recipientRole,
          recipientName: input.recipientName ?? null,
          recipientAddress: input.recipientAddress ?? null,
          deliveryMethod: input.deliveryMethod,
          sentAt: input.sentAt ? new Date(input.sentAt) : new Date(),
          certifiedTrackingNo: input.certifiedTrackingNo ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: `An unanswered ${input.noticeType} to the ${input.recipientRole} already exists; record its response first.`,
          });
        }
        throw err;
      }

      // Advance the workflow step forward to reflect the notice (never regress).
      const target = stepForNotice(input.noticeType);
      if (target && STEP_RANK[target] > STEP_RANK[existing.currentStep]) {
        await tx
          .update(lienCases)
          .set({ currentStep: target, updatedAt: new Date() })
          .where(eq(lienCases.id, caseId));
      }

      const fresh = await this.requireCase(tx, caseId);
      await this.recomputeDue(tx, fresh);
      await this.addTimeline(tx, ctx, caseId, 'notice_recorded', {
        noticeId: id,
        noticeType: input.noticeType,
        recipientRole: input.recipientRole,
        deliveryMethod: input.deliveryMethod,
      });
      const updated = await this.requireCase(tx, caseId);
      return this.buildDetail(tx, updated);
    });
  }

  async recordResponse(
    ctx: CallerCtx,
    caseId: string,
    noticeId: string,
    input: RecordLienResponsePayload,
  ): Promise<LienCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      const notice = await tx.query.lienNotices.findFirst({
        where: and(eq(lienNotices.id, noticeId), isNull(lienNotices.deletedAt)),
      });
      if (!notice || notice.lienCaseId !== caseId) throw notFound('Notice not found');

      const respondedAt = input.responseReceivedAt
        ? new Date(input.responseReceivedAt)
        : new Date();
      await tx
        .update(lienNotices)
        .set({
          responseReceivedAt: respondedAt,
          responseNotes: input.responseNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(lienNotices.id, noticeId));

      await this.recomputeDue(tx, existing);
      await this.addTimeline(tx, ctx, caseId, 'response_recorded', {
        noticeId,
        noticeType: notice.noticeType,
        recipientRole: notice.recipientRole,
      });
      const fresh = await this.requireCase(tx, caseId);
      return this.buildDetail(tx, fresh);
    });
  }

  // ===================================================================
  // Form data (the PDF route reads this)
  // ===================================================================

  async getCaseForForm(
    ctx: CallerCtx,
    caseId: string,
  ): Promise<{ caseRow: typeof lienCases.$inferSelect; impound: LienImpoundSummary }> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const caseRow = await this.requireCase(tx, caseId);
      const impound = await this.buildImpoundSummary(tx, caseRow);
      return { caseRow, impound };
    });
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async requireCase(tx: Tx, caseId: string): Promise<typeof lienCases.$inferSelect> {
    const row = await tx.query.lienCases.findFirst({
      where: and(eq(lienCases.id, caseId), isNull(lienCases.deletedAt)),
    });
    if (!row) throw notFound('Lien case not found');
    return row;
  }

  private async loadNotices(tx: Tx, caseId: string): Promise<(typeof lienNotices.$inferSelect)[]> {
    return tx.query.lienNotices.findMany({
      where: and(eq(lienNotices.lienCaseId, caseId), isNull(lienNotices.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.sentAt)],
    });
  }

  /** Recompute next_action_due_at from the latest facts + engine. */
  private async recomputeDue(tx: Tx, caseRow: typeof lienCases.$inferSelect): Promise<void> {
    const rules = getStateRules(caseRow.state);
    if (!rules) return;
    const notices = await this.loadNotices(tx, caseRow.id);
    const facts = deriveFacts(caseRow, notices);
    const next = computeNextAction(facts, rules, new Date());
    await tx
      .update(lienCases)
      .set({ nextActionDueAt: next.dueAt, updatedAt: new Date() })
      .where(eq(lienCases.id, caseRow.id));
  }

  private async addTimeline(
    tx: Tx,
    ctx: CallerCtx,
    caseId: string,
    eventType: LienTimelineEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(lienTimelineEvents).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      lienCaseId: caseId,
      eventType,
      occurredAt: new Date(),
      actorUserId: ctx.userId,
      payload,
    });
  }

  private async buildImpoundSummary(
    tx: Tx,
    caseRow: typeof lienCases.$inferSelect,
  ): Promise<LienImpoundSummary> {
    const record = await tx.query.impoundRecords.findFirst({
      where: eq(impoundRecords.id, caseRow.impoundRecordId),
    });
    const yard = record
      ? await tx.query.impoundYards.findFirst({ where: eq(impoundYards.id, record.yardId) })
      : null;
    const arrivedAt = record?.arrivedAt ?? caseRow.openedAt;
    const daysStored = Math.max(0, Math.floor((Date.now() - arrivedAt.getTime()) / 86_400_000));
    const vehicleDescription =
      [record?.vehicleYear, record?.vehicleColor, record?.vehicleMake, record?.vehicleModel]
        .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
        .join(' ') || 'Unidentified vehicle';
    return {
      impoundRecordId: caseRow.impoundRecordId,
      vehicleDescription,
      licensePlate: record?.licensePlate ?? null,
      licenseState: record?.licenseState ?? null,
      vehicleVin: record?.vehicleVin ?? null,
      yardName: yard?.name ?? null,
      arrivedAt: arrivedAt.toISOString(),
      daysStored,
      accruedFeeCents: record?.accruedFeeCents ?? 0,
    };
  }

  private async buildDetail(
    tx: Tx,
    caseRow: typeof lienCases.$inferSelect,
  ): Promise<LienCaseDetailDto> {
    const notices = await this.loadNotices(tx, caseRow.id);
    const timelineRows = await tx.query.lienTimelineEvents.findMany({
      where: and(
        eq(lienTimelineEvents.lienCaseId, caseRow.id),
        isNull(lienTimelineEvents.deletedAt),
      ),
      orderBy: (t, { asc }) => [asc(t.occurredAt)],
    });
    const impound = await this.buildImpoundSummary(tx, caseRow);
    const rules = getStateRules(caseRow.state);
    const next = rules
      ? toNextActionDto(computeNextAction(deriveFacts(caseRow, notices), rules, new Date()))
      : { action: 'none' as const, dueAt: null, blocking: false, reasons: [] };
    return {
      case: toCaseDto(caseRow),
      impound,
      notices: notices.map(toNoticeDto),
      timeline: timelineRows.map(toTimelineDto),
      nextAction: next,
    };
  }
}

// ======================================================================
// Pure helpers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function requireRules(state: string) {
  const rules = getStateRules(state);
  if (!rules) {
    throw new ConflictException({
      code: 'INVALID_STATE',
      message: `Lien processing is not supported for ${state}.`,
    });
  }
  return rules;
}

function assertOpen(status: string): void {
  if (status !== 'open') {
    throw new ConflictException({
      code: 'INVALID_STATE',
      message: `Lien case is '${status}' and can no longer be modified.`,
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function stepForNotice(noticeType: LienNoticeType): LienCaseStep | null {
  switch (noticeType) {
    case 'dmv_request':
      return 'dmv_lookup_requested';
    case 'owner_notice':
      return 'owner_notice_sent';
    case 'lienholder_notice':
      return 'lienholder_notice_sent';
    case 'publication_notice':
      return 'publication_complete';
    default:
      return null;
  }
}

/**
 * Decide which step advanceCase moves to, given the current step + the
 * engine's recommendation. Returns null when the operator must take an
 * explicit action first (record a notice) or the gate is not yet satisfied.
 */
function nextStepFor(
  current: LienCaseStep,
  next: ComputedNextAction,
): { step: LienCaseStep; markReady?: boolean } | null {
  switch (current) {
    case 'opened':
      return { step: 'dmv_lookup_requested' };
    case 'dmv_lookup_requested':
      return { step: 'dmv_lookup_complete' };
    case 'owner_notice_sent':
    case 'lienholder_notice_sent':
    case 'publication_complete':
      // Only advance to the waiting period once no more notices are required.
      if (next.action === 'await_waiting_period' || next.action === 'mark_ready_for_sale') {
        return { step: 'waiting_period' };
      }
      return null;
    case 'waiting_period':
      if (next.action === 'mark_ready_for_sale') return { step: 'ready_for_sale', markReady: true };
      return null;
    default:
      return null;
  }
}

function blockingMessage(next: ComputedNextAction): string {
  const map: Record<string, string> = {
    send_owner_notice: 'Record the owner notice before advancing.',
    send_lienholder_notice: 'Record the lienholder notice before advancing.',
    publish_notice: 'Record the publication notice before advancing.',
    request_dmv_lookup: 'Request the DMV lookup before advancing.',
    complete_dmv_lookup: 'Record the DMV lookup result before advancing.',
    await_waiting_period: next.reasons[0] ?? 'The statutory waiting period has not elapsed.',
    conduct_sale: 'The case is already ready for sale; record the sale via close.',
    resolve_claim: next.reasons[0] ?? 'Resolve the recorded claim before advancing.',
    none: 'The case cannot be advanced from its current state.',
  };
  return map[next.action] ?? 'The case cannot be advanced from its current state.';
}

export function deriveFacts(
  caseRow: typeof lienCases.$inferSelect,
  notices: (typeof lienNotices.$inferSelect)[],
): LienCaseFacts {
  const latest = (type: LienNoticeType): typeof lienNotices.$inferSelect | null => {
    let best: typeof lienNotices.$inferSelect | null = null;
    for (const n of notices) {
      if (n.noticeType !== type) continue;
      if (!best || n.sentAt.getTime() > best.sentAt.getTime()) best = n;
    }
    return best;
  };
  const owner = latest('owner_notice');
  const lien = latest('lienholder_notice');
  const pub = latest('publication_notice');
  const dmv = latest('dmv_request');
  return {
    state: caseRow.state as LienState,
    status: caseRow.status,
    currentStep: caseRow.currentStep,
    valueTier: caseRow.vehicleValueTier,
    ownerFound: caseRow.ownerFound,
    lienholderFound: caseRow.lienholderFound,
    openedAt: caseRow.openedAt,
    dmvLookupCompletedAt: dmv?.responseReceivedAt ?? dmv?.sentAt ?? null,
    ownerNoticeSentAt: owner?.sentAt ?? null,
    lienholderNoticeSentAt: lien?.sentAt ?? null,
    publicationCompletedAt: pub?.sentAt ?? null,
    ownerResponseAt: owner?.responseReceivedAt ?? null,
    lienholderResponseAt: lien?.responseReceivedAt ?? null,
  };
}

function toNextActionDto(c: ComputedNextAction) {
  return {
    action: c.action,
    dueAt: c.dueAt ? c.dueAt.toISOString() : null,
    blocking: c.blocking,
    reasons: c.reasons,
  };
}

function toCaseDto(row: typeof lienCases.$inferSelect): LienCaseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    impoundRecordId: row.impoundRecordId,
    state: row.state,
    status: row.status,
    currentStep: row.currentStep,
    vehicleValueTier: row.vehicleValueTier,
    ownerFound: row.ownerFound,
    lienholderFound: row.lienholderFound,
    estimatedValueCents: row.estimatedValueCents,
    openedAt: row.openedAt.toISOString(),
    nextActionDueAt: row.nextActionDueAt ? row.nextActionDueAt.toISOString() : null,
    readyForSaleAt: row.readyForSaleAt ? row.readyForSaleAt.toISOString() : null,
    soldAt: row.soldAt ? row.soldAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closedReason: row.closedReason,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toNoticeDto(row: typeof lienNotices.$inferSelect): LienNoticeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    lienCaseId: row.lienCaseId,
    noticeType: row.noticeType,
    recipientRole: row.recipientRole,
    recipientName: row.recipientName,
    recipientAddress: row.recipientAddress,
    deliveryMethod: row.deliveryMethod,
    sentAt: row.sentAt.toISOString(),
    certifiedTrackingNo: row.certifiedTrackingNo,
    responseReceivedAt: row.responseReceivedAt ? row.responseReceivedAt.toISOString() : null,
    responseNotes: row.responseNotes,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toTimelineDto(row: typeof lienTimelineEvents.$inferSelect): LienTimelineEventDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    lienCaseId: row.lienCaseId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}
