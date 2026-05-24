/**
 * Heavy-Duty Specialist (Session 36) — eligibility + estimate response
 * DTOs. The decision logic lives in the API module's pure helpers
 * (heavy-duty-eligibility.logic.ts / heavy-duty-rates.logic.ts); these are
 * the wire shapes the web client renders the eligible-trucks /
 * eligible-drivers panels + the on-scene estimate from.
 */
import { z } from 'zod';
import { hdDriverCertTypeValues } from './enums';
import { hdJobAttributeSchema } from './job-attributes';

export const hdEligibleTruckSchema = z.object({
  truckId: z.string().uuid(),
  unitNumber: z.string(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  gvwrClass: z.number().int().nullable(),
  hasRotator: z.boolean(),
  maxRecoveryWeightLbs: z.number().int().nullable(),
});
export type HdEligibleTruckDto = z.infer<typeof hdEligibleTruckSchema>;

export const hdEligibleDriverSchema = z.object({
  driverId: z.string().uuid(),
  name: z.string(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  missingCerts: z.array(z.enum(hdDriverCertTypeValues)),
  expiredCerts: z.array(z.enum(hdDriverCertTypeValues)),
});
export type HdEligibleDriverDto = z.infer<typeof hdEligibleDriverSchema>;

export const hdEstimateLineSchema = z.object({
  code: z.string(),
  label: z.string(),
  quantity: z.number(),
  unitCents: z.number().int(),
  amountCents: z.number().int(),
});
export type HdEstimateLineDto = z.infer<typeof hdEstimateLineSchema>;

export const hdOnSceneEstimateSchema = z.object({
  rateSheetId: z.string().uuid(),
  rateSheetName: z.string(),
  lines: z.array(hdEstimateLineSchema),
  subtotalCents: z.number().int(),
  multiplier: z.number(),
  totalCents: z.number().int(),
});
export type HdOnSceneEstimateDto = z.infer<typeof hdOnSceneEstimateSchema>;

/** The HD job detail aggregate: attributes + the two eligibility panels. */
export const hdJobDetailSchema = z.object({
  attributes: hdJobAttributeSchema,
  eligibleTrucks: z.array(hdEligibleTruckSchema),
  eligibleDrivers: z.array(hdEligibleDriverSchema),
});
export type HdJobDetailDto = z.infer<typeof hdJobDetailSchema>;
