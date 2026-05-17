/**
 * PulseAggregatorService — keeps the `dynamic_pricing_pulse_daily` row
 * for the current tenant/day in sync. Called from the rate-engine
 * acceptance hook after a quote moves to `dispatched` (Build 1's
 * "accepted" lifecycle).
 *
 * The aggregate is a single row per (tenant_id, pulse_date) with the
 * day's revenue, standard-rate-equivalent revenue, delta, accepted-
 * quote count, and a per-tier breakdown jsonb. INSERT ... ON CONFLICT
 * DO UPDATE is the workhorse so two concurrent acceptances can't lose
 * each other's contribution.
 */
import { Injectable } from '@nestjs/common';
import { dynamicPricingPulseDaily, tenants } from '@ustowdispatch/db';
import type { DynamicPricingPulseToday } from '@ustowdispatch/shared';
import { and, eq, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { localDateKey } from './dynamic-pricing-helpers.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

interface RecordAcceptanceInput {
  tenantId: string;
  finalCents: number;
  baseCents: number;
  appliedTiers: Array<{
    tierId: string;
    name: string;
    category: string;
    multiplier: number;
    contributionCents: number;
  }>;
}

@Injectable()
export class PulseAggregatorService {
  constructor(private readonly db: TenantAwareDb) {}

  async recordAcceptance(input: RecordAcceptanceInput): Promise<void> {
    await this.db.runInTenantContext(
      {
        tenantId: input.tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
        requestId: 'pulse-aggregator',
      },
      async (tx) => {
        const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, input.tenantId) });
        const tz = parseTenantTimezone(tenant?.settings);
        const dateKey = localDateKey(new Date(), tz);
        const delta = input.finalCents - input.baseCents;

        // Compose the by-tier patch — server-side jsonb merge so two
        // concurrent acceptances on the same day don't clobber each other.
        const byTierPatch: Record<
          string,
          { name: string; category: string; multiplier: number; contributionCents: number; acceptedCount: number }
        > = {};
        for (const t of input.appliedTiers) {
          byTierPatch[t.tierId] = {
            name: t.name,
            category: t.category,
            multiplier: t.multiplier,
            contributionCents: t.contributionCents,
            acceptedCount: 1,
          };
        }
        const byTierJson = JSON.stringify(byTierPatch);

        // UPSERT with jsonb merge. The merge function keeps existing per-
        // tier counts and adds the incremental contribution_cents.
        await tx.execute(sql`
          INSERT INTO dynamic_pricing_pulse_daily
            (tenant_id, pulse_date, revenue_cents, standard_revenue_cents,
             delta_cents, accepted_quote_count, by_tier, updated_at)
          VALUES
            (${input.tenantId}::uuid, ${dateKey}::date,
             ${input.finalCents}, ${input.baseCents},
             ${delta}, 1, ${byTierJson}::jsonb, now())
          ON CONFLICT (tenant_id, pulse_date) DO UPDATE SET
            revenue_cents          = dynamic_pricing_pulse_daily.revenue_cents + ${input.finalCents},
            standard_revenue_cents = dynamic_pricing_pulse_daily.standard_revenue_cents + ${input.baseCents},
            delta_cents            = dynamic_pricing_pulse_daily.delta_cents + ${delta},
            accepted_quote_count   = dynamic_pricing_pulse_daily.accepted_quote_count + 1,
            by_tier                = dynamic_pricing_pulse_daily.by_tier || ${byTierJson}::jsonb,
            updated_at             = now()
        `);
      },
    );
  }

  async getToday(ctx: CallerCtx): Promise<DynamicPricingPulseToday> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      const tz = parseTenantTimezone(tenant?.settings);
      const dateKey = localDateKey(new Date(), tz);
      const row = await tx.query.dynamicPricingPulseDaily.findFirst({
        where: and(
          eq(dynamicPricingPulseDaily.tenantId, ctx.tenantId),
          eq(dynamicPricingPulseDaily.pulseDate, dateKey),
        ),
      });
      if (!row) {
        return {
          date: dateKey,
          revenueCents: 0,
          standardRevenueCents: 0,
          deltaCents: 0,
          upliftPct: 0,
          acceptedQuoteCount: 0,
          byTier: [],
        };
      }
      const std = Number(row.standardRevenueCents);
      const upliftPct = std > 0 ? (Number(row.deltaCents) / std) * 100 : 0;
      const byTierMap = (row.byTier as Record<string, {
        name: string;
        category: string;
        multiplier: number;
        contributionCents: number;
        acceptedCount: number;
      }>) ?? {};
      const byTier = Object.entries(byTierMap).map(([tierId, t]) => ({
        tierId,
        name: t.name,
        category: t.category,
        acceptedCount: Number(t.acceptedCount ?? 0),
        contributionCents: Number(t.contributionCents ?? 0),
        multiplier: Number(t.multiplier ?? 1),
      }));
      return {
        date: dateKey,
        revenueCents: Number(row.revenueCents),
        standardRevenueCents: std,
        deltaCents: Number(row.deltaCents),
        upliftPct,
        acceptedQuoteCount: row.acceptedQuoteCount,
        byTier,
      };
    });
  }

  private toTenantCtx(ctx: CallerCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
  }
}

function parseTenantTimezone(settings: unknown): string {
  const obj = (settings as Record<string, unknown> | null) ?? null;
  const tz = obj?.timezone;
  if (typeof tz === 'string' && tz.length > 0) return tz;
  return 'America/New_York';
}
