/**
 * Job contracts — the call-intake input, the persisted DTO, and the
 * RateQuote returned by the RateEngineService quote-preview endpoint.
 *
 * Design choices:
 *   - phone is required at intake even though it's the only customer field
 *     truly required to dispatch — the rest is captured to fill the record.
 *   - Either pickup_address or pickup_lat+lng must be present. In v1 the
 *     dispatcher enters the address as text; Mapbox geocoding lands in
 *     Session 5 and will populate lat/lng inline.
 *   - For non-tow services dropoff_* is omitted entirely.
 */
import { z } from 'zod';
import { phoneE164Schema } from './customer';
import { vehicleClassValues, vinSchema } from './vehicle';
export { vehicleClassValues } from './vehicle';
export type { VehicleClass } from './vehicle';

export const jobStatusValues = [
  'new',
  'dispatched',
  'enroute',
  'on_scene',
  'in_progress',
  'completed',
  'cancelled',
  'goa',
] as const;
export type JobStatus = (typeof jobStatusValues)[number];

export const jobServiceTypeValues = [
  'tow',
  'jump_start',
  'lockout',
  'tire_change',
  'fuel',
  'winch',
  'recovery',
  'impound',
  'other',
] as const;
export type JobServiceType = (typeof jobServiceTypeValues)[number];

export const jobAuthorizedByValues = [
  'customer',
  'account_contact',
  'motor_club',
  'police',
  'other',
] as const;
export type JobAuthorizedBy = (typeof jobAuthorizedByValues)[number];

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

const stringLatLng = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .transform((s) => Number(s));

const optionalStringLatLng = z.union([lat, stringLatLng]).optional();
const optionalStringLng = z.union([lng, stringLatLng]).optional();

export const rateLineItemSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  amountCents: z.number().int(),
  /** Optional unit so the UI can render "12.5 mi @ $4.50" properly. */
  unit: z.string().max(40).optional(),
  quantity: z.number().optional(),
});
export type RateLineItem = z.infer<typeof rateLineItemSchema>;

export const rateQuoteSchema = z.object({
  serviceType: z.enum(jobServiceTypeValues),
  vehicleClass: z.enum(vehicleClassValues),
  rateSheetId: z.string().uuid().nullable(),
  rateSheetName: z.string().nullable(),
  /** 'account' | 'tenant_default' | 'fallback' — explains which sheet we used. */
  source: z.enum(['account', 'tenant_default', 'fallback']),
  distanceMiles: z.number().nonnegative(),
  lineItems: z.array(rateLineItemSchema),
  subtotalCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  /** Free-form trace: ordered list of decisions the engine made. Surfaced in audit. */
  calculationTrace: z.array(z.string()),
  currency: z.literal('USD').default('USD'),
});
export type RateQuote = z.infer<typeof rateQuoteSchema>;

const intakeVehicleSchema = z
  .object({
    vin: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(vinSchema)
      .optional(),
    plate: z.string().max(20).optional(),
    plateState: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .length(2)
          .regex(/^[A-Z]{2}$/, 'Two uppercase letters'),
      )
      .optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    make: z.string().max(60).optional(),
    model: z.string().max(120).optional(),
    color: z.string().max(60).optional(),
    vehicleClass: z.enum(vehicleClassValues).default('light_duty'),
    specialInstructions: z.string().max(2000).optional(),
  })
  .refine((v) => v.vin !== undefined || v.plate !== undefined, {
    message: 'Either VIN or plate is required',
    path: ['plate'],
  });
export type IntakeVehicleInput = z.infer<typeof intakeVehicleSchema>;

const intakeCustomerSchema = z.object({
  name: z.string().min(1).max(240),
  phone: phoneE164Schema,
  email: z.string().email().max(254).optional(),
});
export type IntakeCustomerInput = z.infer<typeof intakeCustomerSchema>;

const intakeLocationSchema = z.object({
  address: z.string().min(1).max(500),
  lat: optionalStringLatLng,
  lng: optionalStringLng,
});

export const createJobIntakeSchema = z
  .object({
    customer: intakeCustomerSchema,
    vehicle: intakeVehicleSchema,
    serviceType: z.enum(jobServiceTypeValues),
    pickup: intakeLocationSchema,
    dropoff: intakeLocationSchema.optional(),
    accountId: z.string().uuid().optional(),
    authorizedBy: z.enum(jobAuthorizedByValues).default('customer'),
    authorizedByName: z.string().max(240).optional(),
    notes: z.string().max(4000).optional(),
    /** Optional client-supplied scheduled time (ISO 8601). Defaults to now. */
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((v) => v.serviceType !== 'tow' || v.dropoff !== undefined, {
    message: 'Dropoff is required for tow service',
    path: ['dropoff'],
  });
export type CreateJobIntakePayload = z.infer<typeof createJobIntakeSchema>;

export const quotePreviewSchema = z.object({
  serviceType: z.enum(jobServiceTypeValues),
  vehicleClass: z.enum(vehicleClassValues).default('light_duty'),
  pickup: intakeLocationSchema.optional(),
  dropoff: intakeLocationSchema.optional(),
  accountId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type QuotePreviewPayload = z.infer<typeof quotePreviewSchema>;

export const cancelJobSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelJobPayload = z.infer<typeof cancelJobSchema>;

export const jobSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobNumber: z.string(),
  status: z.enum(jobStatusValues),
  serviceType: z.enum(jobServiceTypeValues),
  customerId: z.string().uuid().nullable(),
  vehicleId: z.string().uuid().nullable(),
  accountId: z.string().uuid().nullable(),
  pickupAddress: z.string(),
  pickupLat: z.number().nullable(),
  pickupLng: z.number().nullable(),
  dropoffAddress: z.string().nullable(),
  dropoffLat: z.number().nullable(),
  dropoffLng: z.number().nullable(),
  authorizedBy: z.enum(jobAuthorizedByValues),
  authorizedByName: z.string().nullable(),
  rateQuotedCents: z.number().int().nonnegative(),
  rateBreakdown: rateQuoteSchema.nullable(),
  notes: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  /** Populated when status leaves `new` via assign(). */
  assignedDriverId: z.string().uuid().nullable(),
  assignedTruckId: z.string().uuid().nullable(),
  assignedShiftId: z.string().uuid().nullable(),
  assignedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type JobDto = z.infer<typeof jobSchema>;

export const intakeResultSchema = z.object({
  job: jobSchema,
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    created: z.boolean(),
  }),
  vehicle: z.object({
    id: z.string().uuid(),
    year: z.number().int().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    plate: z.string().nullable(),
    plateState: z.string().nullable(),
    vin: z.string().nullable(),
    created: z.boolean(),
  }),
  rateQuote: rateQuoteSchema,
});
export type IntakeResultDto = z.infer<typeof intakeResultSchema>;
