/**
 * Rate sheet contract — shape of the JSON document stored in
 * rate_sheets.definition. Used by the API's RateEngineService and the web
 * tenant-settings UI (future).
 *
 * All money is integer cents to avoid float drift. All distances are computed
 * server-side; rate sheets simply specify the per-mile rate for the
 * applicable vehicle class.
 */
import { z } from 'zod';
import { jobServiceTypeValues, vehicleClassValues } from './job';

const cents = z.number().int().nonnegative();
const distanceFractionalMiles = z.number().nonnegative();

/**
 * Time-of-day surcharge windows. Every active call within a window picks up
 * the surcharge once. Window ranges are interpreted in the tenant's local
 * time (we assume the dispatcher's wall clock is the right reference for
 * after-hours pricing). Overnight windows that cross midnight set
 * crossesMidnight=true; e.g. start='22:00', end='06:00'.
 */
export const surchargeWindowSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  /** HH:MM 24-hour. */
  startHHmm: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
  endHHmm: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
  crossesMidnight: z.boolean().default(false),
  amountCents: cents,
  /** Days of week the window applies (0 = Sun … 6 = Sat). [] means every day. */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
});
export type SurchargeWindow = z.infer<typeof surchargeWindowSchema>;

/**
 * Per-service-type pricing. A tow has a base hookup fee and a per-mile rate
 * that depends on vehicle class. Lighter services (jump start, lockout) are
 * usually flat fees with no mileage component.
 */
export const serviceRateSchema = z.object({
  serviceType: z.enum(jobServiceTypeValues),
  baseCents: cents,
  /** Per-class per-mile rate in cents. Missing classes fall back to the entry under 'unknown' or 'light_duty'. */
  perMileCentsByClass: z.record(z.enum(vehicleClassValues), cents).default({}),
  /** Optional flat fee added on top of the base for any vehicle class match. */
  flatFeesByClass: z.record(z.enum(vehicleClassValues), cents).default({}),
});
export type ServiceRate = z.infer<typeof serviceRateSchema>;

export const rateSheetDefinitionSchema = z.object({
  version: z.literal(1).default(1),
  currency: z.literal('USD').default('USD'),
  /** Free miles included in the base fee (per service type). */
  freeMilesIncluded: distanceFractionalMiles.default(0),
  services: z.array(serviceRateSchema).min(1),
  surcharges: z.array(surchargeWindowSchema).default([]),
  /** Always-on line items (admin fee, fuel surcharge). */
  fixedLineItems: z
    .array(
      z.object({
        code: z.string().min(1).max(40),
        label: z.string().min(1).max(80),
        amountCents: cents,
      }),
    )
    .default([]),
});
export type RateSheetDefinition = z.infer<typeof rateSheetDefinitionSchema>;

export const rateSheetSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  definition: rateSheetDefinitionSchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
});
export type RateSheetDto = z.infer<typeof rateSheetSchema>;
