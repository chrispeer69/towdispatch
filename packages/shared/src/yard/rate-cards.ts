/**
 * Yard Management (Session 54) — storage rate-card contracts.
 * Mirrors packages/db/src/schema/storage-rate-cards.ts. Dates cross as
 * YYYY-MM-DD; cents are integers.
 */
import { z } from 'zod';

export const storageVehicleClassValues = [
  'passenger',
  'light_truck',
  'heavy',
  'motorcycle',
  'trailer',
  'rv',
] as const;
export type StorageVehicleClass = (typeof storageVehicleClassValues)[number];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const storageRateCardSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  facilityId: z.string().uuid(),
  name: z.string(),
  vehicleClass: z.enum(storageVehicleClassValues),
  dailyRateCents: z.number().int(),
  freeDays: z.number().int(),
  maxDailyRateCents: z.number().int().nullable(),
  effectiveFrom: dateString,
  effectiveTo: dateString.nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type StorageRateCardDto = z.infer<typeof storageRateCardSchema>;

export const createStorageRateCardSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    vehicleClass: z.enum(storageVehicleClassValues),
    dailyRateCents: z.number().int().min(0).max(100_000_00),
    freeDays: z.number().int().min(0).max(3650).default(0),
    maxDailyRateCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
    effectiveFrom: dateString,
    effectiveTo: dateString.nullable().optional(),
  })
  .strict()
  .refine((v) => v.effectiveTo == null || v.effectiveTo >= v.effectiveFrom, {
    message: 'effectiveTo must be on or after effectiveFrom',
    path: ['effectiveTo'],
  });
export type CreateStorageRateCardPayload = z.infer<typeof createStorageRateCardSchema>;

export const updateStorageRateCardSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    dailyRateCents: z.number().int().min(0).max(100_000_00).optional(),
    freeDays: z.number().int().min(0).max(3650).optional(),
    maxDailyRateCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
    effectiveFrom: dateString.optional(),
    effectiveTo: dateString.nullable().optional(),
  })
  .strict();
export type UpdateStorageRateCardPayload = z.infer<typeof updateStorageRateCardSchema>;
