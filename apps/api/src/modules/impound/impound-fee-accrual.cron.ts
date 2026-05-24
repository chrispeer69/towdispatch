/**
 * ImpoundFeeAccrualCron — Impound & Storage (Session 22).
 *
 * Runs once a day (02:00 server time). For every record whose storage
 * clock is still running (status stored / pending_release), it writes the
 * missing daily_storage fee rows, advances the record's accrued total and
 * last_accrued_on anchor, and flips the lien-eligible flag when the
 * vehicle crosses the lien threshold.
 *
 * Gating: IMPOUND_FEE_CRON_ENABLED env flag (default false). The @Cron
 * decorator still mounts so the schedule is registered, but the tick body
 * short-circuits when disabled — same pattern as TierOfferLifecycleCron /
 * AutoRevertService.
 *
 * Idempotency: daily_storage rows hit the partial unique index
 * (impound_record_id, accrued_for_date) and are inserted with
 * ON CONFLICT DO NOTHING; the accrued-total increment is driven by the
 * count of rows actually inserted, so a re-run never double-bills. Each
 * record is processed in its own admin transaction so one bad row can't
 * roll back the whole sweep.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { impoundFees, impoundRecords, uuidv7 } from '@ustowdispatch/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { computeLienEligibility, planDailyAccrual } from './impound-fees.logic.js';

export interface AccrualTickResult {
  recordsScanned: number;
  recordsAccrued: number;
  daysAccrued: number;
  centsAccrued: number;
  lienFlagged: number;
}

@Injectable()
export class ImpoundFeeAccrualCron {
  private readonly log = new Logger(ImpoundFeeAccrualCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 2 * * *')
  async cronTick(): Promise<AccrualTickResult | null> {
    if (!this.config.config.IMPOUND_FEE_CRON_ENABLED) {
      this.log.debug('ImpoundFeeAccrualCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /**
   * Public entry point so integration tests drive accrual synchronously.
   * `now` is injectable so a test can simulate multi-day catch-up.
   */
  async tick(now: Date = new Date()): Promise<AccrualTickResult> {
    const result: AccrualTickResult = {
      recordsScanned: 0,
      recordsAccrued: 0,
      daysAccrued: 0,
      centsAccrued: 0,
      lienFlagged: 0,
    };

    // Cross-tenant read of the candidate set (admin bypasses RLS).
    const candidates = await this.admin.runAsAdmin({}, async (db) =>
      db.query.impoundRecords.findMany({
        where: and(
          inArray(impoundRecords.status, ['stored', 'pending_release']),
          isNull(impoundRecords.deletedAt),
        ),
        columns: { id: true },
      }),
    );
    result.recordsScanned = candidates.length;

    for (const { id } of candidates) {
      try {
        const perRecord = await this.accrueOne(id, now);
        if (perRecord.daysAccrued > 0) result.recordsAccrued += 1;
        result.daysAccrued += perRecord.daysAccrued;
        result.centsAccrued += perRecord.centsAccrued;
        if (perRecord.lienFlagged) result.lienFlagged += 1;
      } catch (err) {
        this.log.error({
          msg: 'impound accrual failed for record',
          recordId: id,
          err: (err as Error).message,
        });
        // Continue — one record's failure must not abort the sweep.
      }
    }

    this.log.log({ msg: 'impound fee accrual tick', ...result });
    return result;
  }

  private async accrueOne(
    recordId: string,
    now: Date,
  ): Promise<{ daysAccrued: number; centsAccrued: number; lienFlagged: boolean }> {
    return this.admin.runAsAdmin({}, async (db) => {
      const record = await db.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) return { daysAccrued: 0, centsAccrued: 0, lienFlagged: false };

      const plan = planDailyAccrual(
        {
          storageStartedAt: record.storageStartedAt,
          lastAccruedOn: record.lastAccruedOn,
          dailyFeeCents: record.dailyFeeCents,
          status: record.status,
        },
        now,
      );

      let centsAccrued = 0;
      let daysAccrued = 0;
      if (plan.daysToAccrue.length > 0) {
        const inserted = await db
          .insert(impoundFees)
          .values(
            plan.daysToAccrue.map((day) => ({
              id: uuidv7(),
              tenantId: record.tenantId,
              impoundRecordId: record.id,
              feeType: 'daily_storage' as const,
              description: `Daily storage — ${day}`,
              amountCents: record.dailyFeeCents,
              accruedForDate: day,
              createdBy: null,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: impoundFees.id });
        // Only days we actually wrote count toward the accrued total — the
        // partial unique index makes already-billed days a no-op.
        daysAccrued = inserted.length;
        centsAccrued = daysAccrued * record.dailyFeeCents;
      }

      const lien = computeLienEligibility(record.storageStartedAt, now);
      const newlyLienEligible = lien.eligible && !record.lienEligible;

      const patch: Partial<typeof impoundRecords.$inferInsert> & { updatedAt: Date } = {
        updatedAt: now,
      };
      if (daysAccrued > 0) {
        patch.accruedFeeCents = record.accruedFeeCents + centsAccrued;
        patch.lastAccruedOn = plan.newLastAccruedOn;
      }
      if (newlyLienEligible) {
        patch.lienEligible = true;
        patch.lienEligibleAt = now;
      }

      // Avoid a no-op UPDATE (and a spurious audit row) when nothing changed.
      if (daysAccrued > 0 || newlyLienEligible) {
        await db.update(impoundRecords).set(patch).where(eq(impoundRecords.id, record.id));
      }

      return { daysAccrued, centsAccrued, lienFlagged: newlyLienEligible };
    });
  }
}
