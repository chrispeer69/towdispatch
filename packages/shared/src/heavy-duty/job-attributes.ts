/**
 * Heavy-Duty Specialist (Session 36) — hd_job_attributes contracts.
 * jobId is a path param on the write surface. markJobHd is an upsert (one
 * live row per job). on_scene_estimate_cents is written by the estimate
 * generator; final_invoice_cents by finalizeHdInvoice.
 */
import { z } from 'zod';
import { hdIncidentTypeValues } from './enums';

export const hdJobAttributeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  vehicleClass: z.number().int().nullable(),
  vehicleGvwrLbs: z.number().int().nullable(),
  vehicleAxleCount: z.number().int().nullable(),
  incidentType: z.enum(hdIncidentTypeValues).nullable(),
  cargoType: z.string().nullable(),
  requiresRotator: z.boolean(),
  requiresHazmat: z.boolean(),
  requiresDotReport: z.boolean(),
  onSceneEstimateCents: z.number().int().nullable(),
  finalInvoiceCents: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type HdJobAttributeDto = z.infer<typeof hdJobAttributeSchema>;

export const markJobHdSchema = z
  .object({
    vehicleClass: z.number().int().min(1).max(8).nullable().optional(),
    vehicleGvwrLbs: z.number().int().min(0).max(10_000_000).nullable().optional(),
    vehicleAxleCount: z.number().int().min(1).max(20).nullable().optional(),
    incidentType: z.enum(hdIncidentTypeValues).nullable().optional(),
    cargoType: z.string().max(500).nullable().optional(),
    requiresRotator: z.boolean().default(false),
    requiresHazmat: z.boolean().default(false),
    requiresDotReport: z.boolean().default(false),
    notes: z.string().max(20_000).nullable().optional(),
  })
  .strict();
export type MarkJobHdPayload = z.infer<typeof markJobHdSchema>;

export const finalizeHdInvoiceSchema = z
  .object({
    finalInvoiceCents: z.number().int().min(0).max(1_000_000_000),
  })
  .strict();
export type FinalizeHdInvoicePayload = z.infer<typeof finalizeHdInvoiceSchema>;

/**
 * On-scene estimate request. Hours / miles are decimals (a 90-minute
 * winch-out is 1.5h). The generator prices them against the named rate
 * sheet and persists the total to on_scene_estimate_cents.
 */
export const generateHdEstimateSchema = z
  .object({
    rateSheetId: z.string().uuid(),
    laborHours: z.number().min(0).max(1000).default(0),
    winchingHours: z.number().min(0).max(1000).default(0),
    recoveryHours: z.number().min(0).max(1000).default(0),
    rotatorHours: z.number().min(0).max(1000).default(0),
    loadedMiles: z.number().min(0).max(100_000).default(0),
    deadheadMiles: z.number().min(0).max(100_000).default(0),
    includeHookup: z.boolean().default(true),
    afterHours: z.boolean().default(false),
    holiday: z.boolean().default(false),
  })
  .strict();
export type GenerateHdEstimatePayload = z.infer<typeof generateHdEstimateSchema>;
