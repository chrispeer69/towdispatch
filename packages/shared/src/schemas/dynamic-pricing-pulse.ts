/**
 * Today's Pulse + Tier History + Tier Performance + Override Report DTOs.
 */
import { z } from 'zod';

export const dynamicPricingPulseTodaySchema = z.object({
  date: z.string(),
  revenueCents: z.number().int(),
  standardRevenueCents: z.number().int(),
  deltaCents: z.number().int(),
  upliftPct: z.number(),
  acceptedQuoteCount: z.number().int(),
  byTier: z.array(
    z.object({
      tierId: z.string().uuid(),
      name: z.string(),
      category: z.string(),
      acceptedCount: z.number().int(),
      contributionCents: z.number().int(),
      multiplier: z.number(),
    }),
  ),
});
export type DynamicPricingPulseToday = z.infer<typeof dynamicPricingPulseTodaySchema>;

export const tierHistoryRowSchema = z.object({
  activationId: z.string().uuid(),
  tierId: z.string().uuid(),
  tierName: z.string(),
  category: z.string(),
  multiplier: z.number(),
  activatedAt: z.string().datetime(),
  deactivatedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int().nullable(),
  activatedByUserId: z.string().uuid().nullable(),
  activationReason: z.string().nullable(),
  deactivationReason: z.string().nullable(),
});
export type TierHistoryRow = z.infer<typeof tierHistoryRowSchema>;

export const tierPerformanceRowSchema = z.object({
  tierId: z.string().uuid(),
  tierName: z.string(),
  category: z.string(),
  acceptedCount: z.number().int(),
  declineCount: z.number().int(),
  overrideCount: z.number().int(),
  revenueCents: z.number().int(),
  averageMultiplier: z.number(),
});
export type TierPerformanceRow = z.infer<typeof tierPerformanceRowSchema>;

export const overrideReportRowSchema = z.object({
  reasonCode: z.string(),
  count: z.number().int(),
  totalDeltaCents: z.number().int(),
});
export type OverrideReportRow = z.infer<typeof overrideReportRowSchema>;

export const yearOverYearGatedSchema = z.object({
  available: z.literal(false),
  reason: z.literal('insufficient_history'),
  historyMonthsAvailable: z.number().int(),
});
export type YearOverYearGated = z.infer<typeof yearOverYearGatedSchema>;
