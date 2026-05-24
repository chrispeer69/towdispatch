/**
 * Photo Damage Analysis (Session 42) — shared enums.
 *
 * Mirror the CHECK constraints in packages/db/sql/0041_damage_analysis.sql
 * and the Drizzle enum arrays. Keep these in lockstep with the DB.
 */
import { z } from 'zod';

export const damagePhaseValues = ['pre_tow', 'post_tow', 'claim_review'] as const;
export const damagePhaseSchema = z.enum(damagePhaseValues);
export type DamagePhase = z.infer<typeof damagePhaseSchema>;

export const damageAreaValues = [
  'front_bumper',
  'rear_bumper',
  'driver_door',
  'passenger_door',
  'hood',
  'roof',
  'trunk',
  'wheels',
  'windshield',
  'other',
] as const;
export const damageAreaSchema = z.enum(damageAreaValues);
export type DamageArea = z.infer<typeof damageAreaSchema>;

export const damageSeverityValues = ['none', 'minor', 'moderate', 'severe'] as const;
export const damageSeveritySchema = z.enum(damageSeverityValues);
export type DamageSeverity = z.infer<typeof damageSeveritySchema>;

/** Ordinal rank for severity comparison (higher = worse). */
export const damageSeverityRank: Record<DamageSeverity, number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
};

export const damageAnalysisStatusValues = ['queued', 'processing', 'complete', 'failed'] as const;
export const damageAnalysisStatusSchema = z.enum(damageAnalysisStatusValues);
export type DamageAnalysisStatus = z.infer<typeof damageAnalysisStatusSchema>;

export const damageProviderValues = ['stub', 'anthropic', 'openai'] as const;
export const damageProviderSchema = z.enum(damageProviderValues);
export type DamageProviderId = z.infer<typeof damageProviderSchema>;
