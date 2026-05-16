/**
 * Service Rate contracts — the Master Rate Sheet (Admin Settings build 2).
 *
 * One rate row per (service, vehicle_class). For class-independent services
 * (catalog row's applicableVehicleClasses = []), the rate row uses
 * vehicleClass: 'any'. The Zod schema accepts both forms so the table shape
 * stays uniform for the inline-editable grid.
 *
 * priceCents is exchanged as a JS number — bigint mode in Drizzle, validated
 * here as a non-negative safe integer. Anything above
 * Number.MAX_SAFE_INTEGER is rejected at the API boundary; the grid won't
 * generate values anywhere near that ceiling.
 */
import { z } from 'zod';
import { vehicleClassValues } from './vehicle';

export const SERVICE_RATE_ANY_CLASS = 'any' as const;

export const rateVehicleClassValues = [SERVICE_RATE_ANY_CLASS, ...vehicleClassValues] as const;
export type RateVehicleClass = (typeof rateVehicleClassValues)[number];

const priceCentsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const serviceRateRowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  vehicleClass: z.enum(rateVehicleClassValues),
  priceCents: priceCentsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().uuid().nullable(),
});
export type ServiceRateDto = z.infer<typeof serviceRateRowSchema>;

/**
 * Single row in a bulk upsert. priceCents = 0 is a meaningful "$0.00" value
 * the operator typed; clients that want to clear a rate should DELETE the
 * row instead. (The Master Rate Sheet UI uses bulkUpsert exclusively; the
 * DELETE path is reserved for a future Build 5 "clear override" gesture.)
 */
export const serviceRateUpsertItemSchema = z.object({
  serviceId: z.string().uuid(),
  vehicleClass: z.enum(rateVehicleClassValues),
  priceCents: priceCentsSchema,
});
export type ServiceRateUpsertItem = z.infer<typeof serviceRateUpsertItemSchema>;

export const serviceRatesBulkUpsertSchema = z.object({
  rates: z.array(serviceRateUpsertItemSchema).min(1).max(500),
});
export type ServiceRatesBulkUpsertPayload = z.infer<typeof serviceRatesBulkUpsertSchema>;

export const serviceRatesBulkUpsertResponseSchema = z.object({
  saved: z.number().int().nonnegative(),
  rates: z.array(serviceRateRowSchema),
});
export type ServiceRatesBulkUpsertResponse = z.infer<typeof serviceRatesBulkUpsertResponseSchema>;
