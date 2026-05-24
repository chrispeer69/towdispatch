/**
 * LienAdvanceCron — Lien Processing (Session 23).
 *
 * Runs once a day (03:00 server time, one hour after the impound accrual
 * cron). For every OPEN lien case it recomputes next_action_due_at from the
 * rule engine and, when the next action is now due-or-overdue, appends a
 * single `action_due` timeline event so the case surfaces in the operator's
 * "due soon" queue.
 *
 * ⚠️  OBSERVATION ONLY. This cron NEVER sends a notice, NEVER advances
 * current_step, and NEVER marks a case ready-for-sale or sold. Every legal
 * step is an explicit operator action. Auto-progressing a statutory lien
 * sale is exactly the kind of automation that draws regulator complaints —
 * see SESSION_23_DECISIONS.md.
 *
 * Gating: LIEN_ADVANCE_CRON_ENABLED env flag (default false). The @Cron
 * decorator still mounts so the schedule is registered, but the tick body
 * short-circuits when disabled — same pattern as ImpoundFeeAccrualCron. Each
 * case is processed in its own admin transaction so one bad row can't roll
 * back the sweep.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lienCases, lienNotices, lienTimelineEvents, uuidv7 } from '@ustowdispatch/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { deriveFacts } from './lien-processing.service.js';
import { computeNextAction } from './lien-rules.logic.js';
import { getStateRules } from './state-rules.config.js';

export interface LienAdvanceTickResult {
  casesScanned: number;
  dueRecomputed: number;
  overdueFlagged: number;
}

@Injectable()
export class LienAdvanceCron {
  private readonly log = new Logger(LienAdvanceCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 3 * * *')
  async cronTick(): Promise<LienAdvanceTickResult | null> {
    if (!this.config.config.LIEN_ADVANCE_CRON_ENABLED) {
      this.log.debug('LienAdvanceCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests can drive the sweep directly. */
  async tick(now: Date = new Date()): Promise<LienAdvanceTickResult> {
    const result: LienAdvanceTickResult = {
      casesScanned: 0,
      dueRecomputed: 0,
      overdueFlagged: 0,
    };

    const candidates = await this.admin.runAsAdmin({}, async (db) =>
      db.query.lienCases.findMany({
        where: and(
          inArray(lienCases.status, ['open', 'ready_for_sale']),
          isNull(lienCases.deletedAt),
        ),
        columns: { id: true },
      }),
    );
    result.casesScanned = candidates.length;

    for (const { id } of candidates) {
      try {
        const per = await this.sweepOne(id, now);
        if (per.recomputed) result.dueRecomputed += 1;
        if (per.flagged) result.overdueFlagged += 1;
      } catch (err) {
        this.log.error({
          msg: 'lien advance sweep failed for case',
          caseId: id,
          err: (err as Error).message,
        });
        // Continue — one case's failure must not abort the sweep.
      }
    }

    this.log.log({ msg: 'lien advance tick', ...result });
    return result;
  }

  private async sweepOne(
    caseId: string,
    now: Date,
  ): Promise<{ recomputed: boolean; flagged: boolean }> {
    return this.admin.runAsAdmin({}, async (db) => {
      const caseRow = await db.query.lienCases.findFirst({
        where: and(eq(lienCases.id, caseId), isNull(lienCases.deletedAt)),
      });
      if (!caseRow) return { recomputed: false, flagged: false };
      const rules = getStateRules(caseRow.state);
      if (!rules) return { recomputed: false, flagged: false };

      const notices = await db.query.lienNotices.findMany({
        where: and(eq(lienNotices.lienCaseId, caseId), isNull(lienNotices.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.sentAt)],
      });
      const next = computeNextAction(deriveFacts(caseRow, notices), rules, now);

      // Recompute the due date (NEVER touch status / current_step).
      const newDue = next.dueAt;
      const changed =
        (caseRow.nextActionDueAt?.getTime() ?? null) !== (newDue ? newDue.getTime() : null);
      if (changed) {
        await db
          .update(lienCases)
          .set({ nextActionDueAt: newDue, updatedAt: now })
          .where(eq(lienCases.id, caseId));
      }

      // Flag overdue once per (case, dueAt): append an action_due event only
      // if the newest action_due event isn't already for this due date.
      let flagged = false;
      const overdue = newDue !== null && newDue.getTime() <= now.getTime();
      if (overdue) {
        const lastDue = await db.query.lienTimelineEvents.findFirst({
          where: and(
            eq(lienTimelineEvents.lienCaseId, caseId),
            eq(lienTimelineEvents.eventType, 'action_due'),
          ),
          orderBy: [desc(lienTimelineEvents.occurredAt)],
        });
        const dueIso = newDue.toISOString();
        const alreadyFlagged = lastDue && (lastDue.payload as { dueAt?: string }).dueAt === dueIso;
        if (!alreadyFlagged) {
          await db.insert(lienTimelineEvents).values({
            id: uuidv7(),
            tenantId: caseRow.tenantId,
            lienCaseId: caseId,
            eventType: 'action_due',
            occurredAt: now,
            actorUserId: null,
            payload: { action: next.action, dueAt: dueIso, reasons: next.reasons },
          });
          flagged = true;
        }
      }

      return { recomputed: changed, flagged };
    });
  }
}
