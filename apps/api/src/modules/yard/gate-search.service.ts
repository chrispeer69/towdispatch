/**
 * GateSearchService — the gate-booth lookup (Yard Management, Session 54).
 * One query field matches across impound records by plate / VIN / payer
 * (last) name, returning the vehicle, its current stall + facility, the live
 * release-workflow status, and the storage balance owed.
 *
 * NOTE: case-number search is deferred — impound_records has no case number;
 * that identifier lives in the S23 lien module (SESSION_54_DECISIONS.md).
 */
import { Injectable } from '@nestjs/common';
import {
  impoundRecords,
  releaseWorkflows,
  storageCharges,
  yardFacilities,
  yardStalls,
} from '@ustowdispatch/db';
import type { GateSearchMatch, GateSearchResult } from '@ustowdispatch/shared';
import { and, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { CallerCtx } from './yard-facility.service.js';
import { vehicleDescription } from './yard-stall.service.js';

const MAX_MATCHES = 25;

@Injectable()
export class GateSearchService {
  constructor(private readonly db: TenantAwareDb) {}

  async search(ctx: CallerCtx, query: string): Promise<GateSearchResult> {
    const q = query.trim();
    return this.db.runInTenantContext(ctx, async (tx) => {
      const like = `%${q}%`;

      // 1. Direct hits on plate / VIN.
      const direct = await tx.query.impoundRecords.findMany({
        where: and(
          isNull(impoundRecords.deletedAt),
          or(ilike(impoundRecords.licensePlate, like), ilike(impoundRecords.vehicleVin, like)),
        ),
        orderBy: (t, { desc }) => [desc(t.arrivedAt)],
        limit: MAX_MATCHES,
      });

      // 2. Hits via an in-flight release workflow's payer name.
      const byPayer = await tx.query.releaseWorkflows.findMany({
        where: and(
          ilike(releaseWorkflows.payerName, like),
          ne(releaseWorkflows.status, 'cancelled'),
        ),
        columns: { impoundId: true },
        limit: MAX_MATCHES,
      });
      const extraIds = byPayer
        .map((r) => r.impoundId)
        .filter((id) => !direct.some((d) => d.id === id));
      const extra =
        extraIds.length > 0
          ? await tx.query.impoundRecords.findMany({
              where: and(inArray(impoundRecords.id, extraIds), isNull(impoundRecords.deletedAt)),
            })
          : [];

      const records = [...direct, ...extra].slice(0, MAX_MATCHES);
      const matches: GateSearchMatch[] = [];
      for (const rec of records) {
        matches.push(await this.buildMatch(tx, rec));
      }
      return { query: q, matches };
    });
  }

  private async buildMatch(
    tx: Parameters<Parameters<TenantAwareDb['runInTenantContext']>[1]>[0],
    rec: typeof impoundRecords.$inferSelect,
  ): Promise<GateSearchMatch> {
    const stall = await tx.query.yardStalls.findFirst({
      where: and(eq(yardStalls.occupiedByImpoundId, rec.id), isNull(yardStalls.deletedAt)),
    });
    let facilityName: string | null = null;
    let facilityId: string | null = null;
    if (stall) {
      facilityId = stall.facilityId;
      const facility = await tx.query.yardFacilities.findFirst({
        where: eq(yardFacilities.id, stall.facilityId),
        columns: { name: true },
      });
      facilityName = facility?.name ?? null;
    }

    const live = await tx.query.releaseWorkflows.findFirst({
      where: and(eq(releaseWorkflows.impoundId, rec.id), ne(releaseWorkflows.status, 'cancelled')),
      columns: { status: true },
    });

    const charges = await tx.query.storageCharges.findMany({
      where: eq(storageCharges.impoundId, rec.id),
      columns: { amountCents: true },
    });
    const balanceOwedCents = charges.reduce((acc, c) => acc + c.amountCents, 0);

    return {
      impoundId: rec.id,
      vehicleDescription: vehicleDescription(rec),
      licensePlate: rec.licensePlate,
      licenseState: rec.licenseState,
      vehicleVin: rec.vehicleVin,
      status: rec.status,
      facilityId,
      facilityName,
      stallId: stall?.id ?? null,
      stallLabel: stall?.label ?? null,
      releaseStatus: live?.status ?? null,
      balanceOwedCents,
    };
  }
}
