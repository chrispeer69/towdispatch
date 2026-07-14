/**
 * CADS manual override contracts. Dispatcher/admin can force a band
 * globally ('all') or per class (storm mode → AT_CAPACITY at any ratio).
 * Requires a reason; auto-expires (default 4h, max 24h); fully audited.
 * Override wins over computed status; the math keeps running underneath
 * and resumes on expiry/clear.
 */
import { z } from 'zod';
import { CAPACITY_DEFAULTS, capacityBandSchema, capacityClassScopeSchema } from './core';

export const capacityOverrideSchema = z.object({
  id: z.string().uuid(),
  dutyClass: capacityClassScopeSchema,
  forcedBand: capacityBandSchema,
  reason: z.string(),
  expiresAt: z.string().datetime(),
  clearedAt: z.string().datetime().nullable(),
  clearedByName: z.string().nullable(),
  createdAt: z.string().datetime(),
  createdByName: z.string().nullable(),
});
export type CapacityOverrideDto = z.infer<typeof capacityOverrideSchema>;

export const createCapacityOverrideSchema = z.object({
  dutyClass: capacityClassScopeSchema.default('all'),
  forcedBand: capacityBandSchema,
  reason: z.string().trim().min(3, 'A reason is required').max(500),
  /** Minutes until auto-expiry; defaults to the tenant setting. */
  expiresInMinutes: z
    .number()
    .int()
    .positive()
    .max(CAPACITY_DEFAULTS.overrideMaxExpiryMinutes)
    .optional(),
});
export type CreateCapacityOverridePayload = z.infer<typeof createCapacityOverrideSchema>;
