/**
 * CADS live status contracts — what the dashboard widget renders and what
 * the `capacity.status_changed` socket event carries. Internal shape
 * (camelCase); the partner-facing snake_case payload lives in webhook.ts.
 */
import { z } from 'zod';
import { capacityBandSchema, capacityClassScopeSchema, capacityDutyClassSchema } from './core';

export const capacityClassStatusSchema = z.object({
  dutyClass: capacityClassScopeSchema,
  band: capacityBandSchema,
  /** null when the class is OFFLINE (no eligible drivers). */
  ratio: z.number().min(0).nullable(),
  eligibleDrivers: z.number().int().min(0),
  weightedActiveJobs: z.number().min(0),
  /** True when this class's band comes from a manual override. */
  overrideActive: z.boolean(),
  /** Band the math produces underneath any override. */
  computedBand: capacityBandSchema,
});
export type CapacityClassStatus = z.infer<typeof capacityClassStatusSchema>;

export const capacityOverrideSummarySchema = z.object({
  id: z.string().uuid(),
  dutyClass: capacityClassScopeSchema,
  forcedBand: capacityBandSchema,
  reason: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  createdByName: z.string().nullable(),
});
export type CapacityOverrideSummary = z.infer<typeof capacityOverrideSummarySchema>;

export const capacityStatusSchema = z.object({
  classes: z.array(capacityClassStatusSchema),
  blended: capacityClassStatusSchema,
  guidelineMinutes: z.number().int().positive(),
  activeOverrides: z.array(capacityOverrideSummarySchema),
  lastBroadcastAt: z.string().datetime().nullable(),
  computedAt: z.string().datetime(),
});
export type CapacityStatusDto = z.infer<typeof capacityStatusSchema>;

/** Socket payload for DISPATCH_EVENTS.CAPACITY_STATUS_CHANGED. */
export const capacityStatusChangedEventSchema = capacityStatusSchema;
export type CapacityStatusChangedEvent = z.infer<typeof capacityStatusChangedEventSchema>;

/** Truck service-state change payload (recompute trigger + fleet UIs). */
export const truckServiceChangedEventSchema = z.object({
  truckId: z.string().uuid(),
  unitNumber: z.string(),
  inService: z.boolean(),
  dutyClass: capacityDutyClassSchema,
});
export type TruckServiceChangedEvent = z.infer<typeof truckServiceChangedEventSchema>;
