/**
 * Yard Management (Session 54) — auto-billing run + storage charge contracts.
 * Mirrors storage-billing-runs.ts + storage-charges.ts.
 */
import { z } from 'zod';
import { storageVehicleClassValues } from './rate-cards';

export const storageBillingRunStatusValues = ['pending', 'completed', 'failed'] as const;
export type StorageBillingRunStatus = (typeof storageBillingRunStatusValues)[number];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const storageBillingRunSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  facilityId: z.string().uuid().nullable(),
  ranAt: z.string().datetime(),
  periodStart: dateString,
  periodEnd: dateString,
  vehiclesCharged: z.number().int(),
  totalChargedCents: z.number().int(),
  status: z.enum(storageBillingRunStatusValues),
  errorText: z.string().nullable(),
});
export type StorageBillingRunDto = z.infer<typeof storageBillingRunSchema>;

export const storageChargeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundId: z.string().uuid(),
  chargeDate: dateString,
  vehicleClass: z.enum(storageVehicleClassValues),
  rateCardId: z.string().uuid().nullable(),
  amountCents: z.number().int(),
  billingRunId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type StorageChargeDto = z.infer<typeof storageChargeSchema>;

/** Result of a manual or cron billing tick, surfaced to /yard/billing/runs. */
export const storageBillingTickResultSchema = z.object({
  runId: z.string().uuid().nullable(),
  vehiclesScanned: z.number().int(),
  vehiclesCharged: z.number().int(),
  chargesWritten: z.number().int(),
  totalChargedCents: z.number().int(),
  status: z.enum(storageBillingRunStatusValues),
});
export type StorageBillingTickResult = z.infer<typeof storageBillingTickResultSchema>;
