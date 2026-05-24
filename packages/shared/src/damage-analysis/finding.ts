/**
 * Photo Damage Analysis (Session 42) — finding contracts.
 *
 * `damageFindingSchema` is the persisted DTO. `providerFindingSchema` is
 * what a vision provider returns (no ids/tenant — the service assigns
 * those). `overrideFindingSchema` is the operator annotation payload —
 * operators annotate, never delete (evidentiary integrity).
 */
import { z } from 'zod';
import { damageAreaSchema, damageSeveritySchema } from './enums';

/** Normalised (0..1) region on a source photo. */
export const boundingBoxSchema = z.object({
  photoKey: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const damageFindingSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  analysisId: z.string().uuid(),
  area: damageAreaSchema,
  severity: damageSeveritySchema,
  confidencePct: z.number().int().min(0).max(100),
  description: z.string().nullable(),
  boundingBox: boundingBoxSchema.nullable(),
  operatorSeverity: damageSeveritySchema.nullable(),
  operatorNote: z.string().nullable(),
  isDismissed: z.boolean(),
  overriddenBy: z.string().uuid().nullable(),
  overriddenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DamageFindingDto = z.infer<typeof damageFindingSchema>;

/** Raw finding shape a provider emits (validated before persistence). */
export const providerFindingSchema = z.object({
  area: damageAreaSchema,
  severity: damageSeveritySchema,
  confidencePct: z.number().int().min(0).max(100),
  description: z.string().max(2000).optional(),
  boundingBox: boundingBoxSchema.nullable().optional(),
});
export type ProviderFinding = z.infer<typeof providerFindingSchema>;

/** Operator annotation/override payload. At least one field required. */
export const overrideFindingSchema = z
  .object({
    operatorSeverity: damageSeveritySchema.nullable().optional(),
    operatorNote: z.string().max(2000).nullable().optional(),
    isDismissed: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.operatorSeverity !== undefined ||
      v.operatorNote !== undefined ||
      v.isDismissed !== undefined,
    { message: 'at least one of operatorSeverity, operatorNote, isDismissed is required' },
  );
export type OverrideFindingPayload = z.infer<typeof overrideFindingSchema>;
