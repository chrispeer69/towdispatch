/**
 * Dynamic pricing curve — shared zod contracts.
 *
 * Modes:
 *   - 24_hour: array of 24 multipliers (hour 0..23)
 *   - 7x24: array of 7 arrays of 24 multipliers (Sun..Sat)
 *
 * Default 24-hour curve: 1.0 for 06:00–22:00, 1.3 for 22:00–06:00.
 * Default 7×24 curve: same as 24-hour except Sat/Sun 20:00–02:00 → 1.15.
 */
import { z } from 'zod';

export const dynamicPricingCurveModeValues = ['24_hour', '7x24'] as const;
export type DynamicPricingCurveMode = (typeof dynamicPricingCurveModeValues)[number];

const hourlyMultiplier = z.number().positive().max(10);
const hourlyArray = z.array(hourlyMultiplier).length(24);
const weeklyArray = z.array(hourlyArray).length(7);

export const dynamicPricingCurveDataSchema = z.union([hourlyArray, weeklyArray]);
export type DynamicPricingCurveData = z.infer<typeof dynamicPricingCurveDataSchema>;

export const dynamicPricingCurveDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(120),
  mode: z.enum(dynamicPricingCurveModeValues),
  curveData: dynamicPricingCurveDataSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DynamicPricingCurveDto = z.infer<typeof dynamicPricingCurveDtoSchema>;

export const createDynamicPricingCurveSchema = z
  .object({
    name: z.string().min(1).max(120),
    mode: z.enum(dynamicPricingCurveModeValues),
    curveData: dynamicPricingCurveDataSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.mode === '24_hour' && Array.isArray(data.curveData[0])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['curveData'],
        message: 'mode=24_hour requires a flat 24-element array',
      });
    }
    if (data.mode === '7x24' && !Array.isArray(data.curveData[0])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['curveData'],
        message: 'mode=7x24 requires a 7×24 nested array',
      });
    }
  });
export type CreateDynamicPricingCurvePayload = z.infer<typeof createDynamicPricingCurveSchema>;

export const updateDynamicPricingCurveSchema = createDynamicPricingCurveSchema
  .innerType()
  .partial();
export type UpdateDynamicPricingCurvePayload = z.infer<typeof updateDynamicPricingCurveSchema>;

/** Default 24-hour curve. */
export const DEFAULT_24_HOUR_CURVE: number[] = (() => {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    // 22:00–05:59 → 1.3, else 1.0
    out.push(h >= 22 || h < 6 ? 1.3 : 1.0);
  }
  return out;
})();

/** Default 7×24 curve (Sun..Sat). */
export const DEFAULT_7X24_CURVE: number[][] = (() => {
  const out: number[][] = [];
  for (let dow = 0; dow < 7; dow++) {
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      const isOvernight = h >= 22 || h < 6;
      const isWeekend = dow === 0 || dow === 6;
      // Sat/Sun 20:00–01:59 bumps to 1.15 (overrides the 1.3 only between 20-21 local; between 22-01 we keep the higher 1.3)
      if (isOvernight) row.push(1.3);
      else if (isWeekend && (h >= 20 || h < 2)) row.push(1.15);
      else row.push(1.0);
    }
    out.push(row);
  }
  return out;
})();
