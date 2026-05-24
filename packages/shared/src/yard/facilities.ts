/**
 * Yard Management (Session 54) — facility contracts.
 *
 * Mirrors packages/db/src/schema/yard-facilities.ts. `address` and
 * `gateHours` are structured jsonb blobs. Timestamps cross the wire as
 * ISO-8601 strings.
 */
import { z } from 'zod';

export const yardWeekdayValues = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type YardWeekday = (typeof yardWeekdayValues)[number];

export const yardFacilityAddressSchema = z
  .object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(60).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(60).optional(),
  })
  .strict();
export type YardFacilityAddress = z.infer<typeof yardFacilityAddressSchema>;

export const yardGateHoursDaySchema = z
  .object({
    open: z.string().regex(/^\d{2}:\d{2}$/, 'open must be HH:MM'),
    close: z.string().regex(/^\d{2}:\d{2}$/, 'close must be HH:MM'),
    closed: z.boolean().optional(),
  })
  .strict();
export type YardGateHoursDay = z.infer<typeof yardGateHoursDaySchema>;

export const yardGateHoursSchema = z.record(z.enum(yardWeekdayValues), yardGateHoursDaySchema);
export type YardGateHours = z.infer<typeof yardGateHoursSchema>;

export const yardFacilitySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  address: yardFacilityAddressSchema,
  gateHours: yardGateHoursSchema,
  notes: z.string().nullable(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type YardFacilityDto = z.infer<typeof yardFacilitySchema>;

export const createYardFacilitySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    address: yardFacilityAddressSchema.optional(),
    gateHours: yardGateHoursSchema.optional(),
    notes: z.string().max(2000).optional(),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateYardFacilityPayload = z.infer<typeof createYardFacilitySchema>;

export const updateYardFacilitySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    address: yardFacilityAddressSchema.optional(),
    gateHours: yardGateHoursSchema.optional(),
    notes: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateYardFacilityPayload = z.infer<typeof updateYardFacilitySchema>;
