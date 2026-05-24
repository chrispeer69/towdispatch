/**
 * Heavy-Duty Specialist (Session 36) — hd_rate_sheets contracts. Money is
 * cents-per-unit; the two multipliers are decimals in [1, 10] (the DB
 * stores numeric(4,2); the service parses the string to a number on the
 * way out).
 */
import { z } from 'zod';

const multiplier = z.number().min(1).max(10);

export const hdRateSheetSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  hourlyRateCents: z.number().int(),
  hookupFeeCents: z.number().int(),
  winchingPerHrCents: z.number().int(),
  recoveryPerHrCents: z.number().int(),
  rotatorPerHrCents: z.number().int(),
  mileageLoadedCents: z.number().int(),
  mileageDeadheadCents: z.number().int(),
  afterHoursMultiplier: z.number(),
  holidayMultiplier: z.number(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type HdRateSheetDto = z.infer<typeof hdRateSheetSchema>;

const cents = z.number().int().min(0).max(1_000_000_000);

export const createHdRateSheetSchema = z
  .object({
    name: z.string().min(1).max(200),
    hourlyRateCents: cents.default(0),
    hookupFeeCents: cents.default(0),
    winchingPerHrCents: cents.default(0),
    recoveryPerHrCents: cents.default(0),
    rotatorPerHrCents: cents.default(0),
    mileageLoadedCents: cents.default(0),
    mileageDeadheadCents: cents.default(0),
    afterHoursMultiplier: multiplier.default(1),
    holidayMultiplier: multiplier.default(1),
    isActive: z.boolean().default(true),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type CreateHdRateSheetPayload = z.infer<typeof createHdRateSheetSchema>;

export const updateHdRateSheetSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    hourlyRateCents: cents.optional(),
    hookupFeeCents: cents.optional(),
    winchingPerHrCents: cents.optional(),
    recoveryPerHrCents: cents.optional(),
    rotatorPerHrCents: cents.optional(),
    mileageLoadedCents: cents.optional(),
    mileageDeadheadCents: cents.optional(),
    afterHoursMultiplier: multiplier.optional(),
    holidayMultiplier: multiplier.optional(),
    isActive: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();
export type UpdateHdRateSheetPayload = z.infer<typeof updateHdRateSheetSchema>;
