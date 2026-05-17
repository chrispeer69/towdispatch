/**
 * Demand surge — hourly cron suggests an activation when active jobs in a
 * yard exceed configured thresholds vs. the trailing 4-week same-hour-same-
 * weekday baseline.
 */
import { z } from 'zod';

export const dynamicPricingDemandSurgeStatusValues = ['pending', 'approved', 'dismissed'] as const;
export type DynamicPricingDemandSurgeStatus =
  (typeof dynamicPricingDemandSurgeStatusValues)[number];

export const dynamicPricingDemandSurgeSuggestionDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  yardId: z.string().uuid().nullable(),
  thresholdPct: z.number().int(),
  suggestedMultiplier: z.number(),
  currentJobs: z.number().int(),
  baselineJobs: z.number(),
  status: z.enum(dynamicPricingDemandSurgeStatusValues),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().uuid().nullable(),
});
export type DynamicPricingDemandSurgeSuggestionDto = z.infer<
  typeof dynamicPricingDemandSurgeSuggestionDtoSchema
>;

export const approveDemandSurgeSuggestionSchema = z
  .object({
    tierName: z.string().min(1).max(120).optional(),
    autoRevertHours: z.number().int().min(1).max(24).optional(),
  })
  .strict();
export type ApproveDemandSurgeSuggestionPayload = z.infer<
  typeof approveDemandSurgeSuggestionSchema
>;

/** Default thresholds + multipliers (operator-tunable on tenant settings). */
export const DEFAULT_DEMAND_SURGE_THRESHOLDS = [150, 200, 300] as const;
export const DEFAULT_DEMAND_SURGE_MULTIPLIERS = [1.3, 1.6, 2.0] as const;

/** Tenant-level dynamic-pricing config that lives on tenants.settings.dynamicPricing */
export const dynamicPricingTenantSettingsSchema = z.object({
  capMultiplier: z.number().positive().max(10).default(3.0),
  demandSurgeThresholds: z
    .array(z.number().int().min(101).max(1000))
    .length(3)
    .default([150, 200, 300]),
  demandSurgeMultipliers: z.array(z.number().positive().max(10)).length(3).default([1.3, 1.6, 2.0]),
  motorClubStormSurgeEnabled: z.boolean().default(false),
});
export type DynamicPricingTenantSettings = z.infer<typeof dynamicPricingTenantSettingsSchema>;
