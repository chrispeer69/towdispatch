/**
 * RepoComplianceService — Repo Compliance (Session 50).
 *
 * Self-contained compliance layer for repossession cases. Because the S49
 * RepoCaseService + repo_cases table are not on master yet (see
 * SESSION_50_DECISIONS.md D0), this service does NOT own a case table. It
 * provides:
 *   - state rules     : the per-state config served as a queryable DTO.
 *   - pure previews    : computeNextRepoAction / validatePeacefulRepo /
 *                        computePersonalPropertyHold over caller-supplied facts.
 *   - required notices : recorded against a repo_case_id (no FK yet) with a
 *                        computed response_due_at; append-only timeline.
 *
 * Every DB method runs inside runInTenantContext so RLS isolates tenants. All
 * legal DECISIONS live in the pure engine repo-rules.logic.ts; this service is
 * data access + transaction boundaries.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { repoRequiredNotices, repoTimelineEvents, uuidv7 } from '@ustowdispatch/db';
import type {
  ListRepoNoticesFilter,
  RecordRepoNoticePayload,
  RecordRepoNoticeResponsePayload,
  RepoAttemptFacts,
  RepoCaseFacts,
  RepoNextAction,
  RepoNoticeType,
  RepoPeacefulResult,
  RepoPersonalPropertyHoldRequest,
  RepoPersonalPropertyHoldResult,
  RepoRequiredNoticeDto,
  RepoState,
  RepoStateRulesDto,
  RepoTimelineEventDto,
  RepoTimelineEventType,
} from '@ustowdispatch/shared';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../../database/tenant-aware-db.service.js';
import {
  type ComputedRepoAction,
  computeNextRepoAction,
  computePersonalPropertyHold,
  validatePeacefulRepo,
} from './repo-rules.logic.js';
import { REPO_STATE_RULES, getRepoStateRules } from './state-rules.config.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

// Days after a notice is sent that the operator waits for a response before
// the cron flags it overdue. The post-repo notice's window is the redemption
// period; everything else uses a conservative default.
const DEFAULT_RESPONSE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

@Injectable()
export class RepoComplianceService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // State rules (global reference data)
  // ===================================================================

  listStateRules(): RepoStateRulesDto[] {
    const now = new Date().toISOString();
    return (Object.keys(REPO_STATE_RULES) as RepoState[]).map((state) => ({
      state,
      rules: REPO_STATE_RULES[state],
      createdAt: now,
      updatedAt: now,
    }));
  }

  getStateRule(state: string): RepoStateRulesDto {
    const rules = getRepoStateRules(state);
    if (!rules) throw invalidState(state);
    const now = new Date().toISOString();
    return { state, rules, createdAt: now, updatedAt: now };
  }

  // ===================================================================
  // Pure previews (no DB; the S49 RepoCaseService will call the engine
  // directly with a real case once it lands)
  // ===================================================================

  previewNextAction(facts: RepoCaseFacts, today = new Date()): RepoNextAction {
    const rules = getRepoStateRules(facts.state);
    if (!rules) throw invalidState(facts.state);
    return toNextActionDto(computeNextRepoAction(facts, rules, today));
  }

  previewPeacefulRepo(attempt: RepoAttemptFacts): RepoPeacefulResult {
    const rules = getRepoStateRules(attempt.state);
    if (!rules) throw invalidState(attempt.state);
    return validatePeacefulRepo(attempt, rules);
  }

  previewPersonalPropertyHold(
    input: RepoPersonalPropertyHoldRequest,
  ): RepoPersonalPropertyHoldResult {
    const rules = getRepoStateRules(input.state);
    if (!rules) throw invalidState(input.state);
    return computePersonalPropertyHold(new Date(input.recoveredAt), rules);
  }

  // ===================================================================
  // Required notices
  // ===================================================================

  async recordNotice(
    ctx: CallerCtx,
    input: RecordRepoNoticePayload,
  ): Promise<RepoRequiredNoticeDto> {
    const rules = getRepoStateRules(input.state);
    if (!rules) throw invalidState(input.state);

    const sentAt = input.sentAt ? new Date(input.sentAt) : new Date();
    const windowDays =
      input.noticeType === 'post_repo_notice' && rules.redemptionPeriodDays > 0
        ? rules.redemptionPeriodDays
        : DEFAULT_RESPONSE_WINDOW_DAYS;
    const responseDueAt = new Date(sentAt.getTime() + windowDays * DAY_MS);

    return this.db.runInTenantContext(ctx, async (tx) => {
      const id = uuidv7();
      try {
        await tx.insert(repoRequiredNotices).values({
          id,
          tenantId: ctx.tenantId,
          repoCaseId: input.repoCaseId,
          state: input.state,
          noticeType: input.noticeType,
          recipientRole: input.recipientRole,
          recipientName: input.recipientName ?? null,
          recipientAddress: input.recipientAddress ?? null,
          statuteCitation: rules.statute,
          deliveryMethod: input.deliveryMethod,
          certifiedTrackingNo: input.certifiedTrackingNo ?? null,
          sentAt,
          responseDueAt,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: `An unanswered ${input.noticeType} to the ${input.recipientRole} already exists for this case; record its response first.`,
          });
        }
        throw err;
      }

      await this.addTimeline(tx, ctx, input.repoCaseId, 'notice_recorded', {
        noticeId: id,
        noticeType: input.noticeType,
        recipientRole: input.recipientRole,
        deliveryMethod: input.deliveryMethod,
        responseDueAt: responseDueAt.toISOString(),
      });

      const row = await this.requireNotice(tx, id);
      return toNoticeDto(row);
    });
  }

  async listNotices(
    ctx: CallerCtx,
    filter: ListRepoNoticesFilter,
  ): Promise<RepoRequiredNoticeDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(repoRequiredNotices.deletedAt)];
      if (filter.repoCaseId) clauses.push(eq(repoRequiredNotices.repoCaseId, filter.repoCaseId));
      if (filter.state) clauses.push(eq(repoRequiredNotices.state, filter.state));
      if (filter.noticeType) clauses.push(eq(repoRequiredNotices.noticeType, filter.noticeType));
      if (filter.overdue === 'true') {
        clauses.push(isNull(repoRequiredNotices.responseReceivedAt));
        clauses.push(lte(repoRequiredNotices.responseDueAt, new Date()));
      }
      const rows = await tx.query.repoRequiredNotices.findMany({
        where: and(...clauses),
        orderBy: (t, { desc: d }) => [d(t.sentAt)],
      });
      return rows.map(toNoticeDto);
    });
  }

  async recordResponse(
    ctx: CallerCtx,
    noticeId: string,
    input: RecordRepoNoticeResponsePayload,
  ): Promise<RepoRequiredNoticeDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireNotice(tx, noticeId);
      const respondedAt = input.responseReceivedAt
        ? new Date(input.responseReceivedAt)
        : new Date();
      await tx
        .update(repoRequiredNotices)
        .set({
          responseReceivedAt: respondedAt,
          responseNotes: input.responseNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(repoRequiredNotices.id, noticeId));

      await this.addTimeline(tx, ctx, existing.repoCaseId, 'notice_response_recorded', {
        noticeId,
        noticeType: existing.noticeType,
        recipientRole: existing.recipientRole,
      });

      const row = await this.requireNotice(tx, noticeId);
      return toNoticeDto(row);
    });
  }

  async listTimeline(ctx: CallerCtx, repoCaseId: string): Promise<RepoTimelineEventDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.repoTimelineEvents.findMany({
        where: and(
          eq(repoTimelineEvents.repoCaseId, repoCaseId),
          isNull(repoTimelineEvents.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.occurredAt)],
      });
      return rows.map(toTimelineDto);
    });
  }

  /** Flag a breach-of-peace violation on a case (writes a timeline event). */
  async flagBreachOfPeace(
    ctx: CallerCtx,
    repoCaseId: string,
    attempt: RepoAttemptFacts,
  ): Promise<RepoPeacefulResult> {
    const result = this.previewPeacefulRepo(attempt);
    if (!result.allowed) {
      await this.db.runInTenantContext(ctx, async (tx) => {
        await this.addTimeline(tx, ctx, repoCaseId, 'breach_of_peace_flagged', {
          violations: result.violations,
          statuteCitation: result.statuteCitation,
        });
      });
    }
    return result;
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async requireNotice(
    tx: Tx,
    noticeId: string,
  ): Promise<typeof repoRequiredNotices.$inferSelect> {
    const row = await tx.query.repoRequiredNotices.findFirst({
      where: and(eq(repoRequiredNotices.id, noticeId), isNull(repoRequiredNotices.deletedAt)),
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Repo notice not found' });
    return row;
  }

  private async addTimeline(
    tx: Tx,
    ctx: CallerCtx,
    repoCaseId: string,
    eventType: RepoTimelineEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(repoTimelineEvents).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      repoCaseId,
      eventType,
      occurredAt: new Date(),
      actorUserId: ctx.userId,
      payload,
    });
  }
}

// ======================================================================
// Pure helpers
// ======================================================================

function invalidState(state: string): ConflictException {
  return new ConflictException({
    code: 'INVALID_STATE',
    message: `Repo compliance is not yet supported for ${state}.`,
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function toNextActionDto(c: ComputedRepoAction): RepoNextAction {
  return {
    action: c.action,
    dueAt: c.dueAt ? c.dueAt.toISOString() : null,
    blocking: c.blocking,
    statuteCitation: c.statuteCitation,
    reasons: c.reasons,
  };
}

function toNoticeDto(row: typeof repoRequiredNotices.$inferSelect): RepoRequiredNoticeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    repoCaseId: row.repoCaseId,
    state: row.state,
    noticeType: row.noticeType as RepoNoticeType,
    recipientRole: row.recipientRole,
    recipientName: row.recipientName,
    recipientAddress: row.recipientAddress,
    statuteCitation: row.statuteCitation,
    deliveryMethod: row.deliveryMethod,
    certifiedTrackingNo: row.certifiedTrackingNo,
    sentAt: row.sentAt.toISOString(),
    responseDueAt: row.responseDueAt ? row.responseDueAt.toISOString() : null,
    responseReceivedAt: row.responseReceivedAt ? row.responseReceivedAt.toISOString() : null,
    responseNotes: row.responseNotes,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toTimelineDto(row: typeof repoTimelineEvents.$inferSelect): RepoTimelineEventDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    repoCaseId: row.repoCaseId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}
