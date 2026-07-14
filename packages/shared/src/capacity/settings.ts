/**
 * CADS per-tenant settings contracts — thresholds, job weights,
 * hysteresis, broadcast debounce, guideline minutes, zone flag.
 */
import { z } from 'zod';
import { CAPACITY_DEFAULTS } from './core';

/** job status → weight; statuses absent from the map count 0. */
export const capacityJobWeightsSchema = z.record(z.string(), z.number().min(0).max(10));
export type CapacityJobWeights = z.infer<typeof capacityJobWeightsSchema>;

/** Columns are numeric(6,3): anything >= 1000 would overflow Postgres. */
const RATIO_MAX = 999.999;

export const capacitySettingsSchema = z.object({
  availableMaxRatio: z.number().positive().max(RATIO_MAX),
  limitedMaxRatio: z.number().positive().max(RATIO_MAX),
  constrainedMaxRatio: z.number().positive().max(RATIO_MAX),
  jobWeights: capacityJobWeightsSchema,
  hysteresisBuffer: z.number().min(0).max(1),
  hysteresisDwellSeconds: z.number().int().min(0).max(3600),
  minBroadcastIntervalSeconds: z.number().int().min(0).max(3600),
  guidelineMinutes: z.number().int().positive().max(720),
  overrideDefaultExpiryMinutes: z
    .number()
    .int()
    .positive()
    .max(CAPACITY_DEFAULTS.overrideMaxExpiryMinutes),
  perYardEnabled: z.boolean(),
});
export type CapacitySettingsDto = z.infer<typeof capacitySettingsSchema>;

/** Bands must stay strictly ordered: available < limited < constrained. */
export function assertBandsOrdered(s: {
  availableMaxRatio: number;
  limitedMaxRatio: number;
  constrainedMaxRatio: number;
}): boolean {
  return (
    s.availableMaxRatio > 0 &&
    s.limitedMaxRatio > s.availableMaxRatio &&
    s.constrainedMaxRatio > s.limitedMaxRatio
  );
}

export const updateCapacitySettingsSchema = capacitySettingsSchema.partial();
export type UpdateCapacitySettingsPayload = z.infer<typeof updateCapacitySettingsSchema>;

export const defaultCapacitySettings: CapacitySettingsDto = {
  availableMaxRatio: CAPACITY_DEFAULTS.availableMaxRatio,
  limitedMaxRatio: CAPACITY_DEFAULTS.limitedMaxRatio,
  constrainedMaxRatio: CAPACITY_DEFAULTS.constrainedMaxRatio,
  jobWeights: { ...CAPACITY_DEFAULTS.jobWeights },
  hysteresisBuffer: CAPACITY_DEFAULTS.hysteresisBuffer,
  hysteresisDwellSeconds: CAPACITY_DEFAULTS.hysteresisDwellSeconds,
  minBroadcastIntervalSeconds: CAPACITY_DEFAULTS.minBroadcastIntervalSeconds,
  guidelineMinutes: CAPACITY_DEFAULTS.guidelineMinutes,
  overrideDefaultExpiryMinutes: CAPACITY_DEFAULTS.overrideDefaultExpiryMinutes,
  perYardEnabled: false,
};
