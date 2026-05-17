/**
 * TierResolutionService — given a quote context (tenant_id, optional
 * yard_id, time, base price), return the active tier stack and the
 * computed effective multiplier (capped per tenant settings).
 *
 * Tiers are read from `dynamic_pricing_tiers` where `is_active = true`
 * AND `deleted_at IS NULL`. Yard scoping rule: `scope_yard_ids` empty or
 * NULL means "all yards"; otherwise the requested yard must be in the
 * array. Tiers without a yard match are skipped (not in the suppressed
 * pile — they're simply out-of-scope).
 *
 * Time-of-Day curve handling: when a tier is `category=time_of_day`, the
 * tier's stored multiplier is treated as the *active flag*; the actual
 * multiplier resolves from the tenant's active curve at the tenant's
 * local hour/dow. This keeps the curve a separate first-class concept
 * while sharing the activation/deactivation state with the rest of the
 * tier system.
 */
import { Injectable } from '@nestjs/common';
import {
  dynamicPricingCurves,
  dynamicPricingTiers,
  tenants,
} from '@ustowdispatch/db';
import {
  type DynamicPricingCategory,
  type DynamicPricingCurveData,
  type DynamicPricingCurveMode,
  type DynamicPricingTenantSettings,
  dynamicPricingTenantSettingsSchema,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import {
  applyStackToBase,
  localDow,
  localHour,
  resolveCurveMultiplier,
  stackTiers,
  type StackingResult,
  type TierForStack,
} from './dynamic-pricing-helpers.js';

export interface ResolveContext {
  tenantId: string;
  userId: string;
  requestId: string;
  yardId?: string | null | undefined;
  /** Time at which the quote is being evaluated. Defaults to now. */
  at?: Date | undefined;
  baseCents: number;
}

export interface ResolvedStack {
  baseCents: number;
  finalCents: number;
  capMultiplier: number;
  effectiveMultiplier: number;
  capped: boolean;
  /** Per-tier list with contribution cents, in display order. */
  tiers: Array<{
    tierId: string;
    name: string;
    category: DynamicPricingCategory;
    multiplier: number;
    contributionCents: number;
  }>;
}

@Injectable()
export class TierResolutionService {
  constructor(private readonly db: TenantAwareDb) {}

  async resolveStack(ctx: ResolveContext): Promise<ResolvedStack> {
    const at = ctx.at ?? new Date();
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx): Promise<ResolvedStack> => {
        // Load tenant settings to read the cap.
        const tenantRow = await tx.query.tenants.findFirst({
          where: eq(tenants.id, ctx.tenantId),
        });
        const settings = parseDynamicPricingSettings(tenantRow?.settings);
        const tz = parseTenantTimezone(tenantRow?.settings);

        // Load all currently-active tiers for the tenant (RLS will filter).
        const activeTiers = await tx.query.dynamicPricingTiers.findMany({
          where: and(
            eq(dynamicPricingTiers.isActive, true),
            isNull(dynamicPricingTiers.deletedAt),
          ),
        });

        // Filter by yard scope.
        const inScope = activeTiers.filter((t) => {
          const scope = t.scopeYardIds as string[] | null | undefined;
          if (!scope || scope.length === 0) return true; // all-yards
          if (!ctx.yardId) return false;
          return scope.includes(ctx.yardId);
        });

        // For time_of_day tiers, swap the stored multiplier for the curve
        // value at the tenant-local hour. This is the only category that
        // resolves dynamically against an external table; the others use
        // the tier row's stored multiplier verbatim.
        let curveMultiplier: number | null = null;
        if (inScope.some((t) => t.category === 'time_of_day')) {
          const activeCurve = await tx.query.dynamicPricingCurves.findFirst({
            where: and(
              eq(dynamicPricingCurves.isActive, true),
              isNull(dynamicPricingCurves.deletedAt),
            ),
          });
          if (activeCurve) {
            const dow = localDow(at, tz);
            const hour = localHour(at, tz);
            curveMultiplier = resolveCurveMultiplier(
              activeCurve.curveData as DynamicPricingCurveData,
              activeCurve.mode as DynamicPricingCurveMode,
              dow,
              hour,
            );
          }
        }

        const stackInput: TierForStack[] = inScope.map((t) => ({
          tierId: t.id,
          name: t.name,
          category: t.category as DynamicPricingCategory,
          multiplier:
            t.category === 'time_of_day' && curveMultiplier !== null
              ? curveMultiplier
              : Number(t.multiplier),
        }));

        const stack: StackingResult = stackTiers(stackInput, settings.capMultiplier);
        const { finalCents, perTierContribution } = applyStackToBase(ctx.baseCents, stack);

        return {
          baseCents: ctx.baseCents,
          finalCents,
          capMultiplier: settings.capMultiplier,
          effectiveMultiplier: stack.effectiveMultiplier,
          capped: stack.capped,
          tiers: stack.appliedTiers.map((t) => ({
            tierId: t.tierId,
            name: t.name,
            category: t.category,
            multiplier: t.multiplier,
            contributionCents: perTierContribution.get(t.tierId) ?? 0,
          })),
        };
      },
    );
  }
}

/**
 * Read tenants.settings.dynamicPricing with safe defaults. The settings
 * column is jsonb; we tolerate missing or partial config and let zod fill
 * in defaults from the tenant-settings schema.
 */
export function parseDynamicPricingSettings(
  settings: unknown,
): DynamicPricingTenantSettings {
  const obj = (settings as Record<string, unknown> | null) ?? null;
  const candidate = obj?.dynamicPricing ?? {};
  const parsed = dynamicPricingTenantSettingsSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // On parse failure, return all defaults.
  return dynamicPricingTenantSettingsSchema.parse({});
}

function parseTenantTimezone(settings: unknown): string {
  const obj = (settings as Record<string, unknown> | null) ?? null;
  const tz = obj?.timezone;
  if (typeof tz === 'string' && tz.length > 0) return tz;
  return 'America/New_York';
}
