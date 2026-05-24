/**
 * Drug & alcohol program contracts — Full DOT Compliance, Session 37.
 * Log-only (49 CFR Part 382); no consortium integration this session.
 */
import { z } from 'zod';

export const dotDrugAlcoholTestTypeValues = [
  'pre_employment',
  'random',
  'reasonable_suspicion',
  'post_accident',
  'return_to_duty',
  'follow_up',
] as const;
export type DotDrugAlcoholTestType = (typeof dotDrugAlcoholTestTypeValues)[number];

export const dotDrugAlcoholResultValues = ['negative', 'positive', 'refused', 'cancelled'] as const;
export type DotDrugAlcoholResult = (typeof dotDrugAlcoholResultValues)[number];

export const dotDrugAlcoholTestSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  testType: z.enum(dotDrugAlcoholTestTypeValues),
  collectedAt: z.string().datetime(),
  result: z.enum(dotDrugAlcoholResultValues),
  lab: z.string().nullable(),
  docKey: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DotDrugAlcoholTestDto = z.infer<typeof dotDrugAlcoholTestSchema>;

export const recordDrugTestSchema = z
  .object({
    driverId: z.string().uuid(),
    testType: z.enum(dotDrugAlcoholTestTypeValues),
    collectedAt: z.string().datetime(),
    result: z.enum(dotDrugAlcoholResultValues),
    lab: z.string().max(200).optional(),
    docKey: z.string().max(1024).optional(),
    notes: z.string().max(20_000).optional(),
  })
  .strict();
export type RecordDrugTestPayload = z.infer<typeof recordDrugTestSchema>;

export const listDrugTestFilterSchema = z
  .object({
    driverId: z.string().uuid().optional(),
    testType: z.enum(dotDrugAlcoholTestTypeValues).optional(),
    result: z.enum(dotDrugAlcoholResultValues).optional(),
  })
  .strict();
export type ListDrugTestFilter = z.infer<typeof listDrugTestFilterSchema>;
