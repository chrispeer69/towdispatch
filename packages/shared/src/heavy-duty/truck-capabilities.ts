/**
 * Heavy-Duty Specialist (Session 36) — hd_truck_capabilities contracts.
 * truckId is a path param on the write surface, not a body field. Setting
 * capabilities is an upsert (one live row per truck) and flips
 * trucks.heavy_duty_capable=true in the service layer.
 */
import { z } from 'zod';

export const hdTruckCapabilitySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  truckId: z.string().uuid(),
  gvwrClass: z.number().int().nullable(),
  winchCapacityLbs: z.number().int().nullable(),
  boomCapacityLbs: z.number().int().nullable(),
  hasRotator: z.boolean(),
  hasUnderLift: z.boolean(),
  hasAirCushions: z.boolean(),
  axleCount: z.number().int().nullable(),
  maxRecoveryWeightLbs: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type HdTruckCapabilityDto = z.infer<typeof hdTruckCapabilitySchema>;

export const setHdTruckCapabilitiesSchema = z
  .object({
    gvwrClass: z.number().int().min(3).max(8).nullable().optional(),
    winchCapacityLbs: z.number().int().min(0).max(10_000_000).nullable().optional(),
    boomCapacityLbs: z.number().int().min(0).max(10_000_000).nullable().optional(),
    hasRotator: z.boolean().default(false),
    hasUnderLift: z.boolean().default(false),
    hasAirCushions: z.boolean().default(false),
    axleCount: z.number().int().min(1).max(20).nullable().optional(),
    maxRecoveryWeightLbs: z.number().int().min(0).max(10_000_000).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();
export type SetHdTruckCapabilitiesPayload = z.infer<typeof setHdTruckCapabilitiesSchema>;
