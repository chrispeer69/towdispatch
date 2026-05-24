/**
 * Photo Damage Analysis (Session 42) — analysis + request contracts.
 *
 * `vehicleContext` is deliberately PII-free: make/model/year/color only.
 * VIN, plate, and owner identity are NEVER sent to a third-party vision
 * provider (ARCHITECTURE.md — PII redaction).
 */
import { z } from 'zod';
import { damageAnalysisStatusSchema, damagePhaseSchema, damageProviderSchema } from './enums';
import { damageFindingSchema } from './finding';

/** Non-PII vehicle hints passed to the vision provider. */
export const vehicleContextSchema = z.object({
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  color: z.string().max(40).optional(),
});
export type VehicleContext = z.infer<typeof vehicleContextSchema>;

export const damageAnalysisSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  phase: damagePhaseSchema,
  photoKeys: z.array(z.string()),
  provider: damageProviderSchema,
  model: z.string().nullable(),
  status: damageAnalysisStatusSchema,
  error: z.string().nullable(),
  retryCount: z.number().int(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DamageAnalysisDto = z.infer<typeof damageAnalysisSchema>;

/** Analysis row plus its findings. */
export const damageAnalysisDetailSchema = damageAnalysisSchema.extend({
  findings: z.array(damageFindingSchema),
});
export type DamageAnalysisDetailDto = z.infer<typeof damageAnalysisDetailSchema>;

/** POST /damage-analysis — request an analysis run. */
export const requestAnalysisSchema = z.object({
  jobId: z.string().uuid(),
  phase: damagePhaseSchema,
  photoKeys: z.array(z.string().min(1)).min(1).max(20),
  vehicleContext: vehicleContextSchema.optional(),
});
export type RequestAnalysisPayload = z.infer<typeof requestAnalysisSchema>;

/** GET /damage-analysis?jobId= — list filter. */
export const listAnalysesQuerySchema = z.object({
  jobId: z.string().uuid(),
  phase: damagePhaseSchema.optional(),
});
export type ListAnalysesQuery = z.infer<typeof listAnalysesQuerySchema>;
