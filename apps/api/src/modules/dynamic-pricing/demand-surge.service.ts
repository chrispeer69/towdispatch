/**
 * DemandSurgeService — hourly cron. For each tenant, computes the
 * current active-job count vs. the trailing-4-week same-hour-same-
 * weekday baseline per yard. When current exceeds a tenant-configured
 * threshold (defaults [150, 200, 300]%), writes a "pending" suggestion
 * row that the operator approves or dismisses on the Control Panel.
 *
 * Phase 1 yard scoping uses the job's `assigned_truck_id` only as a
 * proxy when actual yard ids aren't on jobs (judgment: this is good
 * enough for Phase 1; Phase 3 introduces real yard polygons). For the
 * MVP we treat all jobs as belonging to a single tenant-wide bucket
 * (yard_id NULL) so the unique partial index in the DB enforces "one
 * pending suggestion per tenant".
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  dynamicPricingDemandSurgeSuggestions,
  jobs,
  tenants,
  uuidv7,
} from '@ustowdispatch/db';
import {
  DEFAULT_DEMAND_SURGE_MULTIPLIERS,
  DEFAULT_DEMAND_SURGE_THRESHOLDS,
  type DynamicPricingTenantSettings,
} from '@ustowdispatch/shared';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { localDow, localHour, pickDemandSurgeTier, trailingBaseline } from './dynamic-pricing-helpers.js';
import { parseDynamicPricingSettings } from './tier-resolution.service.js';

const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class DemandSurgeService {
  private readonly log = new Logger(DemandSurgeService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
    private readonly txRunner: TransactionRunner,
  ) {}

  /**
   * Runs every hour at :05 (avoids weather poller at :00, auto-revert at :03).
   */
  @Cron('5 * * * *')
  async tick(): Promise<void> {
    if (!this.config.dynamicPricing.cronEnabled) {
      this.log.debug('DemandSurge: cron disabled by env flag');
      return;
    }
    await this.runForAllTenants();
  }

  async runForAllTenants(): Promise<{ suggestionsCreated: number }> {
    const allTenants = await this.txRunner.runAsAdmin({}, async (tx) => {
      return tx.query.tenants.findMany({ where: isNull(tenants.deletedAt) });
    });
    let total = 0;
    for (const t of allTenants) {
      total += await this.runForTenant(t.id);
    }
    return { suggestionsCreated: total };
  }

  async runForTenant(tenantId: string): Promise<number> {
    return this.db.runInTenantContext(
      { tenantId, userId: SYSTEM_USER_UUID, requestId: `demand-surge-${tenantId}` },
      async (tx) => {
        const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
        const settings = parseDynamicPricingSettings(tenant?.settings);
        const tz = parseTenantTimezone(tenant?.settings);
        const now = new Date();
        const dow = localDow(now, tz);
        const hour = localHour(now, tz);

        // current = active-status jobs created in the last hour
        // (proxy for "in-flight workload" without needing a positions table).
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const currentRows = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(jobs)
          .where(and(gte(jobs.createdAt, oneHourAgo), isNull(jobs.deletedAt)));
        const current = currentRows[0]?.c ?? 0;

        // baseline = average count across the same DOW + same hour for
        // the last 4 weeks (each cell = jobs created in that 1-hour window).
        const cells: number[] = [];
        for (let weeksAgo = 1; weeksAgo <= 4; weeksAgo++) {
          const cellStart = new Date(now.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000);
          // Set the local hour boundaries to match the current hour.
          const fromUtc = new Date(cellStart);
          fromUtc.setUTCMinutes(0, 0, 0);
          const toUtc = new Date(fromUtc.getTime() + 60 * 60 * 1000);
          const cellRows = await tx
            .select({ c: sql<number>`count(*)::int` })
            .from(jobs)
            .where(
              and(
                gte(jobs.createdAt, fromUtc),
                lte(jobs.createdAt, toUtc),
                isNull(jobs.deletedAt),
              ),
            );
          const c = cellRows[0]?.c ?? 0;
          cells.push(c);
        }
        const baseline = trailingBaseline(cells);
        if (baseline === null) {
          this.log.debug(
            `DemandSurge ${tenantId} dow=${dow} h=${hour}: no baseline history yet`,
          );
          return 0;
        }
        const thresholds =
          settings.demandSurgeThresholds.length === 3
            ? settings.demandSurgeThresholds
            : [...DEFAULT_DEMAND_SURGE_THRESHOLDS];
        const multipliers =
          settings.demandSurgeMultipliers.length === 3
            ? settings.demandSurgeMultipliers
            : [...DEFAULT_DEMAND_SURGE_MULTIPLIERS];

        const pick = pickDemandSurgeTier(current, baseline, thresholds, multipliers);
        if (!pick) {
          this.log.debug(
            `DemandSurge ${tenantId}: current=${current}, baseline=${baseline.toFixed(2)} — under threshold`,
          );
          return 0;
        }

        // Insert pending suggestion (idempotent: the partial unique
        // index on (tenant, yard, threshold) WHERE status='pending'
        // prevents duplicate pending rows).
        try {
          await tx.insert(dynamicPricingDemandSurgeSuggestions).values({
            id: uuidv7(),
            tenantId,
            yardId: null,
            thresholdPct: pick.thresholdPct,
            suggestedMultiplier: pick.multiplier.toString(),
            currentJobs: current,
            baselineJobs: baseline.toFixed(2),
            status: 'pending',
          });
          this.log.log(
            `DemandSurge ${tenantId}: created suggestion threshold=${pick.thresholdPct}% mult=${pick.multiplier}`,
          );
          return 1;
        } catch (err) {
          // Unique-violation = there's already a pending row. Not a real error.
          this.log.debug(
            `DemandSurge ${tenantId}: pending suggestion already exists for threshold ${pick.thresholdPct}`,
          );
          return 0;
        }
      },
    );
  }
}

function parseTenantTimezone(settings: unknown): string {
  const obj = (settings as Record<string, unknown> | null) ?? null;
  const tz = obj?.timezone;
  if (typeof tz === 'string' && tz.length > 0) return tz;
  return 'America/New_York';
}
