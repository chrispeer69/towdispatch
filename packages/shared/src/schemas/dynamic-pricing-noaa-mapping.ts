/**
 * Dynamic pricing NOAA mapping — shared zod contracts.
 *
 * 12 default mappings (operator can edit, disable, or add):
 *   Winter Storm Warning   1.5
 *   Blizzard Warning       2.0
 *   Ice Storm Warning      2.0
 *   Severe Thunderstorm Warning 1.3
 *   Tornado Warning        1.8
 *   Hurricane Warning      2.5
 *   Tropical Storm Warning 1.5
 *   Flood Warning          1.4
 *   Excessive Heat Warning 1.2
 *   Dense Fog Advisory     1.1
 *   High Wind Warning      1.3
 *   Freeze Warning         1.2
 */
import { z } from 'zod';

export const DEFAULT_NOAA_MAPPINGS: ReadonlyArray<{ alertType: string; multiplier: number }> = [
  { alertType: 'Winter Storm Warning', multiplier: 1.5 },
  { alertType: 'Blizzard Warning', multiplier: 2.0 },
  { alertType: 'Ice Storm Warning', multiplier: 2.0 },
  { alertType: 'Severe Thunderstorm Warning', multiplier: 1.3 },
  { alertType: 'Tornado Warning', multiplier: 1.8 },
  { alertType: 'Hurricane Warning', multiplier: 2.5 },
  { alertType: 'Tropical Storm Warning', multiplier: 1.5 },
  { alertType: 'Flood Warning', multiplier: 1.4 },
  { alertType: 'Excessive Heat Warning', multiplier: 1.2 },
  { alertType: 'Dense Fog Advisory', multiplier: 1.1 },
  { alertType: 'High Wind Warning', multiplier: 1.3 },
  { alertType: 'Freeze Warning', multiplier: 1.2 },
];

export const dynamicPricingNoaaMappingDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  noaaAlertType: z.string().min(1).max(120),
  multiplier: z.number().positive().max(10),
  isEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DynamicPricingNoaaMappingDto = z.infer<typeof dynamicPricingNoaaMappingDtoSchema>;

export const createDynamicPricingNoaaMappingSchema = z
  .object({
    noaaAlertType: z.string().min(1).max(120),
    multiplier: z.number().positive().max(10),
    isEnabled: z.boolean().default(true),
  })
  .strict();
export type CreateDynamicPricingNoaaMappingPayload = z.infer<
  typeof createDynamicPricingNoaaMappingSchema
>;

export const updateDynamicPricingNoaaMappingSchema =
  createDynamicPricingNoaaMappingSchema.partial();
export type UpdateDynamicPricingNoaaMappingPayload = z.infer<
  typeof updateDynamicPricingNoaaMappingSchema
>;
