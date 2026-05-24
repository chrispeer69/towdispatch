/**
 * RepoComplianceAdvanceCron — Repo Compliance (Session 50).
 *
 * Runs daily at 03:30 server time (after the lien 03:00 sweep). For every
 * required notice that is response-overdue (sent, no response, response_due_at
 * elapsed) it appends a single `notice_overdue` timeline event so the case
 * surfaces in the operator's queue.
 *
 * ⚠️  OBSERVATION ONLY. This cron NEVER sends a notice, advances a case, or
 * releases property. Every legal step is an explicit operator action.
 *
 * Gating: REPO_ADVANCE_CRON_ENABLED env flag (default false). The @Cron
 * decorator still mounts so the schedule is registered, but the tick body
 * short-circuits when disabled — same pattern as LienAdvanceCron.
 *
 * S49 note: because there is no repo_cases table yet, the sweep operates purely
 * over repo_required_notices / repo_timeline_events. The richer "scan cases →
 * compute next action" sweep is part of the deferred S49 integration (D4).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { repoRequiredNotices, repoTimelineEvents, uuidv7 } from '@ustowdispatch/db';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { ConfigService } from '../../../config/config.service.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';

export interface RepoAdvanceTickResult {
  noticesScanned: number;
  overdueFlagged: number;
}

@Injectable()
export class RepoComplianceAdvanceCron {
  private readonly log = new Logger(RepoComplianceAdvanceCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  @Cron('30 3 * * *')
  async cronTick(): Promise<RepoAdvanceTickResult | null> {
    if (!this.config.config.REPO_ADVANCE_CRON_ENABLED) {
      this.log.debug('RepoComplianceAdvanceCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests can drive the sweep directly. */
  async tick(now: Date = new Date()): Promise<RepoAdvanceTickResult> {
    const result: RepoAdvanceTickResult = { noticesScanned: 0, overdueFlagged: 0 };

    const overdue = await this.admin.runAsAdmin({}, async (db) =>
      db.query.repoRequiredNotices.findMany({
        where: and(
          isNull(repoRequiredNotices.responseReceivedAt),
          isNull(repoRequiredNotices.deletedAt),
          lte(repoRequiredNotices.responseDueAt, now),
        ),
        columns: {
          id: true,
          tenantId: true,
          repoCaseId: true,
          noticeType: true,
          responseDueAt: true,
        },
      }),
    );
    result.noticesScanned = overdue.length;

    for (const notice of overdue) {
      try {
        const flagged = await this.flagOne(notice, now);
        if (flagged) result.overdueFlagged += 1;
      } catch (err) {
        this.log.error({
          msg: 'repo advance sweep failed for notice',
          noticeId: notice.id,
          err: (err as Error).message,
        });
        // Continue — one notice's failure must not abort the sweep.
      }
    }

    this.log.log({ msg: 'repo advance tick', ...result });
    return result;
  }

  private async flagOne(
    notice: {
      id: string;
      tenantId: string;
      repoCaseId: string;
      noticeType: string;
      responseDueAt: Date | null;
    },
    now: Date,
  ): Promise<boolean> {
    return this.admin.runAsAdmin({}, async (db) => {
      const dueIso = notice.responseDueAt ? notice.responseDueAt.toISOString() : null;
      // Flag once per (notice, dueAt): skip if the newest notice_overdue event
      // for this case already references this notice + due date.
      const last = await db.query.repoTimelineEvents.findFirst({
        where: and(
          eq(repoTimelineEvents.repoCaseId, notice.repoCaseId),
          eq(repoTimelineEvents.eventType, 'notice_overdue'),
        ),
        orderBy: [desc(repoTimelineEvents.occurredAt)],
      });
      const lastPayload = last?.payload as { noticeId?: string; dueAt?: string } | undefined;
      if (lastPayload && lastPayload.noticeId === notice.id && lastPayload.dueAt === dueIso) {
        return false;
      }
      await db.insert(repoTimelineEvents).values({
        id: uuidv7(),
        tenantId: notice.tenantId,
        repoCaseId: notice.repoCaseId,
        eventType: 'notice_overdue',
        occurredAt: now,
        actorUserId: null,
        payload: { noticeId: notice.id, noticeType: notice.noticeType, dueAt: dueIso },
      });
      return true;
    });
  }
}
