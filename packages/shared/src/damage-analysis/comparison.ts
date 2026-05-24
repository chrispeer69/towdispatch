/**
 * Photo Damage Analysis (Session 42) — comparison contracts.
 *
 * The pure comparison logic (apps/api .../compare.logic.ts) classifies
 * each post-tow area against pre-tow into new damage, pre-existing, or
 * inconclusive. `DEFAULT_DAMAGE_CONFIDENCE_THRESHOLD` is a fraction (0..1)
 * — a finding below it is treated as inconclusive, not actionable.
 */
import { z } from 'zod';
import { damageAreaSchema, damageSeveritySchema } from './enums';
import { boundingBoxSchema, damageFindingSchema } from './finding';

/** Default confidence threshold (fraction 0..1) for comparison. */
export const DEFAULT_DAMAGE_CONFIDENCE_THRESHOLD = 0.65;

/** One classified entry in a comparison result. */
export const compareFindingEntrySchema = z.object({
  area: damageAreaSchema,
  severity: damageSeveritySchema,
  confidencePct: z.number().int().min(0).max(100),
  priorSeverity: damageSeveritySchema.nullable(),
  description: z.string().nullable(),
  boundingBox: boundingBoxSchema.nullable(),
  reason: z.string(),
});
export type CompareFindingEntry = z.infer<typeof compareFindingEntrySchema>;

export const compareResultSchema = z.object({
  newDamage: z.array(compareFindingEntrySchema),
  preExisting: z.array(compareFindingEntrySchema),
  inconclusive: z.array(compareFindingEntrySchema),
});
export type CompareResult = z.infer<typeof compareResultSchema>;

/** Persisted comparison row DTO. */
export const damageComparisonSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  preAnalysisId: z.string().uuid(),
  postAnalysisId: z.string().uuid(),
  newDamageFindings: z.array(compareFindingEntrySchema),
  comparisonSummary: z.string().nullable(),
  confidenceThreshold: z.number().min(0).max(1),
  generatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DamageComparisonDto = z.infer<typeof damageComparisonSchema>;

/** POST /damage-analysis/compare — request a comparison. */
export const compareAnalysesSchema = z.object({
  preAnalysisId: z.string().uuid(),
  postAnalysisId: z.string().uuid(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type CompareAnalysesPayload = z.infer<typeof compareAnalysesSchema>;

/**
 * Compare endpoint response — the persisted comparison plus the full
 * classified result and both sides' findings, so the web side-by-side
 * view can render and highlight without a second round-trip.
 */
export const compareAnalysisResponseSchema = z.object({
  comparison: damageComparisonSchema,
  result: compareResultSchema,
  preFindings: z.array(damageFindingSchema),
  postFindings: z.array(damageFindingSchema),
});
export type CompareAnalysisResponse = z.infer<typeof compareAnalysisResponseSchema>;
