/**
 * Dynamic pricing holiday — shared zod contracts.
 *
 * 14 US federal holiday defaults (operator can edit / disable / add).
 *
 * `dateSpec` shape:
 *   - fixed_date  : { month: 1..12, day: 1..31 }
 *   - nth_weekday : { month: 1..12, weekday: 0..6 (0=Sun), ordinal: 1..5 (or -1 for last) }
 */
import { z } from 'zod';

export const dynamicPricingHolidayOccurrenceValues = ['fixed_date', 'nth_weekday'] as const;
export type DynamicPricingHolidayOccurrence =
  (typeof dynamicPricingHolidayOccurrenceValues)[number];

export const dynamicPricingHolidayDateSpecSchema = z.union([
  z.object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
  z.object({
    month: z.number().int().min(1).max(12),
    weekday: z.number().int().min(0).max(6),
    ordinal: z
      .number()
      .int()
      .min(-1)
      .max(5)
      .refine((v) => v !== 0, 'ordinal cannot be 0'),
  }),
]);
export type DynamicPricingHolidayDateSpec = z.infer<typeof dynamicPricingHolidayDateSpecSchema>;

export const dynamicPricingHolidayDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(160),
  occurrence: z.enum(dynamicPricingHolidayOccurrenceValues),
  dateSpec: dynamicPricingHolidayDateSpecSchema,
  multiplier: z.number().positive().max(10),
  isEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DynamicPricingHolidayDto = z.infer<typeof dynamicPricingHolidayDtoSchema>;

export const createDynamicPricingHolidaySchema = z
  .object({
    name: z.string().min(1).max(160),
    occurrence: z.enum(dynamicPricingHolidayOccurrenceValues),
    dateSpec: dynamicPricingHolidayDateSpecSchema,
    multiplier: z.number().positive().max(10),
    isEnabled: z.boolean().default(true),
  })
  .strict();
export type CreateDynamicPricingHolidayPayload = z.infer<typeof createDynamicPricingHolidaySchema>;

export const updateDynamicPricingHolidaySchema = createDynamicPricingHolidaySchema.partial();
export type UpdateDynamicPricingHolidayPayload = z.infer<typeof updateDynamicPricingHolidaySchema>;

/** 14 US federal holiday defaults seeded at first save. */
export const DEFAULT_US_HOLIDAYS: ReadonlyArray<{
  name: string;
  occurrence: DynamicPricingHolidayOccurrence;
  dateSpec: DynamicPricingHolidayDateSpec;
  multiplier: number;
}> = [
  {
    name: "New Year's Eve",
    occurrence: 'fixed_date',
    dateSpec: { month: 12, day: 31 },
    multiplier: 1.8,
  },
  {
    name: "New Year's Day",
    occurrence: 'fixed_date',
    dateSpec: { month: 1, day: 1 },
    multiplier: 2.0,
  },
  {
    name: 'MLK Day',
    occurrence: 'nth_weekday',
    dateSpec: { month: 1, weekday: 1, ordinal: 3 },
    multiplier: 1.2,
  },
  {
    name: 'Presidents Day',
    occurrence: 'nth_weekday',
    dateSpec: { month: 2, weekday: 1, ordinal: 3 },
    multiplier: 1.2,
  },
  {
    name: 'Memorial Day',
    occurrence: 'nth_weekday',
    dateSpec: { month: 5, weekday: 1, ordinal: -1 },
    multiplier: 1.3,
  },
  {
    name: 'Juneteenth',
    occurrence: 'fixed_date',
    dateSpec: { month: 6, day: 19 },
    multiplier: 1.2,
  },
  {
    name: 'Independence Day',
    occurrence: 'fixed_date',
    dateSpec: { month: 7, day: 4 },
    multiplier: 1.5,
  },
  {
    name: 'Labor Day',
    occurrence: 'nth_weekday',
    dateSpec: { month: 9, weekday: 1, ordinal: 1 },
    multiplier: 1.3,
  },
  {
    name: 'Columbus Day',
    occurrence: 'nth_weekday',
    dateSpec: { month: 10, weekday: 1, ordinal: 2 },
    multiplier: 1.2,
  },
  {
    name: 'Veterans Day',
    occurrence: 'fixed_date',
    dateSpec: { month: 11, day: 11 },
    multiplier: 1.2,
  },
  {
    name: 'Thanksgiving',
    occurrence: 'nth_weekday',
    dateSpec: { month: 11, weekday: 4, ordinal: 4 },
    multiplier: 1.5,
  },
  {
    name: 'Day After Thanksgiving',
    occurrence: 'nth_weekday',
    dateSpec: { month: 11, weekday: 5, ordinal: 4 },
    multiplier: 1.3,
  },
  {
    name: 'Christmas Eve',
    occurrence: 'fixed_date',
    dateSpec: { month: 12, day: 24 },
    multiplier: 1.5,
  },
  {
    name: 'Christmas Day',
    occurrence: 'fixed_date',
    dateSpec: { month: 12, day: 25 },
    multiplier: 2.0,
  },
];
