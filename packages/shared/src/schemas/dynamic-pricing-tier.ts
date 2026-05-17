/**
 * Dynamic pricing tier — shared zod contracts.
 *
 * Five categories: weather, traffic, calendar, time_of_day, special_event.
 * `multiplier` is bounded 0 < x ≤ 10 (matches DB CHECK).
 */
import { z } from 'zod';

export const dynamicPricingCategoryValues = [
  'weather',
  'traffic',
  'calendar',
  'time_of_day',
  'special_event',
] as const;
export type DynamicPricingCategory = (typeof dynamicPricingCategoryValues)[number];

export const dynamicPricingScheduleSchema = z
  .object({
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
  })
  .strict();
export type DynamicPricingSchedule = z.infer<typeof dynamicPricingScheduleSchema>;

export const dynamicPricingTierDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(120),
  category: z.enum(dynamicPricingCategoryValues),
  multiplier: z.number().positive().max(10),
  scopeYardIds: z.array(z.string().uuid()).nullable(),
  isActive: z.boolean(),
  schedule: dynamicPricingScheduleSchema.nullable().optional(),
  autoRevertAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DynamicPricingTierDto = z.infer<typeof dynamicPricingTierDtoSchema>;

export const createDynamicPricingTierSchema = z
  .object({
    name: z.string().min(1).max(120),
    category: z.enum(dynamicPricingCategoryValues),
    multiplier: z.number().positive().max(10),
    scopeYardIds: z.array(z.string().uuid()).max(50).optional(),
    schedule: dynamicPricingScheduleSchema.optional(),
  })
  .strict();
export type CreateDynamicPricingTierPayload = z.infer<typeof createDynamicPricingTierSchema>;

export const updateDynamicPricingTierSchema = createDynamicPricingTierSchema
  .partial()
  .extend({
    autoRevertAt: z.string().datetime().nullable().optional(),
  });
export type UpdateDynamicPricingTierPayload = z.infer<typeof updateDynamicPricingTierSchema>;

export const activateDynamicPricingTierSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();
export type ActivateDynamicPricingTierPayload = z.infer<typeof activateDynamicPricingTierSchema>;

export const deactivateDynamicPricingTierSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();
export type DeactivateDynamicPricingTierPayload = z.infer<
  typeof deactivateDynamicPricingTierSchema
>;

/**
 * Inline tier breakdown attached to a quote response so the operator UI
 * can show name + category + multiplier + dollar contribution.
 */
export const dynamicPricingQuoteBreakdownEntrySchema = z.object({
  tierId: z.string().uuid(),
  name: z.string(),
  category: z.enum(dynamicPricingCategoryValues),
  multiplier: z.number(),
  contributionCents: z.number().int(),
});
export type DynamicPricingQuoteBreakdownEntry = z.infer<
  typeof dynamicPricingQuoteBreakdownEntrySchema
>;

export const dynamicPricingQuoteBreakdownSchema = z.object({
  baseCents: z.number().int(),
  finalCents: z.number().int(),
  cappedAt: z.number().nullable(),
  capMultiplier: z.number(),
  tiers: z.array(dynamicPricingQuoteBreakdownEntrySchema),
});
export type DynamicPricingQuoteBreakdown = z.infer<typeof dynamicPricingQuoteBreakdownSchema>;
