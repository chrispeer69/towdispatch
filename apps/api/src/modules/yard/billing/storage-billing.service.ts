/**
 * StorageBillingService — the rate-card-driven daily storage charge engine
 * (Yard Management, Session 54). Charges run per tenant for a single
 * calendar day (default: today, UTC). A vehicle accrues a storage_charge
 * only while it is (a) a live, still-stored impound record and (b) parked in
 * a yard stall — the stall identifies which facility's rate card applies
 * (impound_records link to S22 impound_yards, not yard_facilities). See
 * SESSION_54_DECISIONS.md.
 *
 * Idempotency: storage_charges has a unique index on (impound_id,
 * charge_date); inserts use ON CONFLICT DO NOTHING, and the run total is
 * driven by rows ACTUALLY inserted, so a second run on the same day is a
 * no-op. INDEPENDENT of the S22 impound_fees ledger.
 *
 * Runs use the admin pool (cross-RLS) but every query is explicitly scoped
 * by tenant_id — the same posture as ImpoundFeeAccrualCron.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  impoundRecords,
  storageBillingRuns,
  storageCharges,
  storageRateCards,
  uuidv7,
  vehicles,
  yardStalls,
} from '@ustowdispatch/db';
import type { StorageBillingTickResult } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import {
  classifyFromVehicle,
  computeDailyStorageCharge,
  diffUtcDays,
  resolveRate,
  toUtcDateString,
} from '../storage-rate.logic.js';

@Injectable()
export class StorageBillingService {
  private readonly log = new Logger(StorageBillingService.name);

  constructor(private readonly admin: TransactionRunner) {}

  /** Recent billing-run summaries for a tenant (newest first). */
  async listRuns(
    tenantId: string,
    limit = 50,
  ): Promise<(typeof storageBillingRuns.$inferSelect)[]> {
    return this.admin.runAsAdmin({}, async (db) =>
      db.query.storageBillingRuns.findMany({
        where: eq(storageBillingRuns.tenantId, tenantId),
        orderBy: (t, { desc }) => [desc(t.ranAt)],
        limit,
      }),
    );
  }

  /** Tenant ids that currently have at least one occupied stall. */
  async tenantsWithOccupiedStalls(): Promise<string[]> {
    const rows = await this.admin.runAsAdmin({}, async (db) =>
      db
        .selectDistinct({ tenantId: yardStalls.tenantId })
        .from(yardStalls)
        .where(isNull(yardStalls.deletedAt)),
    );
    return rows.map((r) => r.tenantId);
  }

  /**
   * Charge one tenant's stall-assigned stored vehicles for `now`'s calendar
   * day, writing a storage_billing_runs summary row. Never throws on a
   * per-vehicle problem — those are skipped; an infra failure marks the run
   * 'failed' and rethrows so the caller's retry can act.
   */
  async runForTenant(tenantId: string, now: Date = new Date()): Promise<StorageBillingTickResult> {
    const chargeDate = toUtcDateString(now);
    const runId = uuidv7();

    await this.admin.runAsAdmin({}, async (db) => {
      await db.insert(storageBillingRuns).values({
        id: runId,
        tenantId,
        facilityId: null,
        ranAt: now,
        periodStart: chargeDate,
        periodEnd: chargeDate,
        status: 'pending',
      });
    });

    try {
      const result = await this.admin.runAsAdmin({}, async (db) => {
        const occupied = await db.query.yardStalls.findMany({
          where: and(eq(yardStalls.tenantId, tenantId), isNull(yardStalls.deletedAt)),
          columns: { facilityId: true, occupiedByImpoundId: true },
        });
        const placements = occupied.filter(
          (s): s is { facilityId: string; occupiedByImpoundId: string } =>
            s.occupiedByImpoundId !== null,
        );

        let vehiclesScanned = 0;
        let chargesWritten = 0;
        let totalCents = 0;
        const chargedImpounds = new Set<string>();

        for (const placement of placements) {
          vehiclesScanned += 1;
          const record = await db.query.impoundRecords.findFirst({
            where: and(
              eq(impoundRecords.id, placement.occupiedByImpoundId),
              isNull(impoundRecords.deletedAt),
            ),
          });
          if (!record) continue;
          if (record.releasedAt !== null) continue;
          if (record.status !== 'stored' && record.status !== 'pending_release') continue;

          const dayIndex = diffUtcDays(toUtcDateString(record.storageStartedAt), chargeDate);
          if (dayIndex < 0) continue;

          const vehicle = record.vehicleId
            ? await db.query.vehicles.findFirst({ where: eq(vehicles.id, record.vehicleId) })
            : null;
          const { vehicleClass } = classifyFromVehicle(vehicle ?? null);

          const cards = await db.query.storageRateCards.findMany({
            where: and(
              eq(storageRateCards.tenantId, tenantId),
              eq(storageRateCards.facilityId, placement.facilityId),
              eq(storageRateCards.vehicleClass, vehicleClass),
              isNull(storageRateCards.deletedAt),
            ),
            columns: {
              id: true,
              effectiveFrom: true,
              effectiveTo: true,
              dailyRateCents: true,
              freeDays: true,
              maxDailyRateCents: true,
            },
          });
          const card = resolveRate(cards, chargeDate);
          if (!card) continue; // no rate configured for this day — needs setup

          const day = computeDailyStorageCharge(card, dayIndex);
          if (!day.charged) continue; // within free_days

          const inserted = await db
            .insert(storageCharges)
            .values({
              id: uuidv7(),
              tenantId,
              impoundId: record.id,
              chargeDate,
              vehicleClass,
              rateCardId: card.id,
              amountCents: day.amountCents,
              billingRunId: runId,
            })
            .onConflictDoNothing({
              target: [storageCharges.impoundId, storageCharges.chargeDate],
            })
            .returning({ id: storageCharges.id });

          if (inserted.length > 0) {
            chargesWritten += 1;
            totalCents += day.amountCents;
            chargedImpounds.add(record.id);
          }
        }

        await db
          .update(storageBillingRuns)
          .set({
            status: 'completed',
            vehiclesCharged: chargedImpounds.size,
            totalChargedCents: totalCents,
            updatedAt: now,
          })
          .where(eq(storageBillingRuns.id, runId));

        return {
          runId,
          vehiclesScanned,
          vehiclesCharged: chargedImpounds.size,
          chargesWritten,
          totalChargedCents: totalCents,
          status: 'completed' as const,
        };
      });
      return result;
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      this.log.error({ msg: 'storage billing run failed', tenantId, runId, err: message });
      await this.admin.runAsAdmin({}, async (db) => {
        await db
          .update(storageBillingRuns)
          .set({ status: 'failed', errorText: message, updatedAt: new Date() })
          .where(eq(storageBillingRuns.id, runId));
      });
      throw err;
    }
  }
}
