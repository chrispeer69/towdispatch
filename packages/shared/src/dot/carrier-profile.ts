/**
 * Carrier profile contracts — the tenant's FMCSA identity (Full DOT
 * Compliance, Session 37). One profile per tenant.
 */
import { z } from 'zod';

export const dotCarrierTypeValues = ['authorized_for_hire', 'private', 'exempt'] as const;
export type DotCarrierType = (typeof dotCarrierTypeValues)[number];

export const dotSafetyRatingValues = [
  'satisfactory',
  'conditional',
  'unsatisfactory',
  'unrated',
] as const;
export type DotSafetyRating = (typeof dotSafetyRatingValues)[number];

export const dotCarrierProfileSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  usdotNumber: z.string().nullable(),
  mcNumber: z.string().nullable(),
  legalName: z.string(),
  dbaName: z.string().nullable(),
  carrierType: z.enum(dotCarrierTypeValues),
  operatingClassification: z.array(z.string()),
  safetyRating: z.enum(dotSafetyRatingValues).nullable(),
  lastAuditedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DotCarrierProfileDto = z.infer<typeof dotCarrierProfileSchema>;

export const upsertDotCarrierProfileSchema = z
  .object({
    usdotNumber: z.string().max(32).optional(),
    mcNumber: z.string().max(32).optional(),
    legalName: z.string().min(1).max(200),
    dbaName: z.string().max(200).optional(),
    carrierType: z.enum(dotCarrierTypeValues).default('authorized_for_hire'),
    operatingClassification: z.array(z.string().max(80)).max(20).default([]),
    safetyRating: z.enum(dotSafetyRatingValues).optional(),
    lastAuditedAt: z.string().datetime().optional(),
  })
  .strict();
export type UpsertDotCarrierProfilePayload = z.infer<typeof upsertDotCarrierProfileSchema>;
