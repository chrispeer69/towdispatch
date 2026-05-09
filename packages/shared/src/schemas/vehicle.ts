/**
 * Vehicle contract schemas. VIN validation enforces the standard 17-char
 * uppercase A-Z (no I/O/Q) + digits format. Plate state is the 2-letter
 * USPS code; the underlying CHECK constraint also enforces uppercase only.
 */
import { z } from 'zod';

export const vehicleClassValues = [
  'light_duty',
  'medium_duty',
  'heavy_duty',
  'motorcycle',
  'commercial',
  'rv',
  'unknown',
] as const;
export type VehicleClass = (typeof vehicleClassValues)[number];

export const drivetrainValues = ['FWD', 'RWD', 'AWD', '4WD', 'unknown'] as const;
export type Drivetrain = (typeof drivetrainValues)[number];

export const vinSchema = z
  .string()
  .length(17)
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, '17 characters; uppercase A-Z (no I/O/Q) and digits only');

const plateStateSchema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'Two uppercase letters (e.g. OH, CA)');

export const vehicleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  vin: vinSchema.nullable(),
  plate: z.string().max(20).nullable(),
  plateState: plateStateSchema.nullable(),
  year: z.number().int().min(1900).max(2100).nullable(),
  make: z.string().max(60).nullable(),
  model: z.string().max(120).nullable(),
  trim: z.string().max(120).nullable(),
  color: z.string().max(60).nullable(),
  bodyClass: z.string().max(120).nullable(),
  vehicleClass: z.enum(vehicleClassValues),
  drivetrain: z.enum(drivetrainValues),
  isElectric: z.boolean(),
  isLowClearance: z.boolean(),
  specialInstructions: z.string().max(2000).nullable(),
  defaultCustomerId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
});
export type VehicleDto = z.infer<typeof vehicleSchema>;

export const vehicleWithCustomersSchema = vehicleSchema.extend({
  customers: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      phone: z.string().nullable(),
      relationship: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
});
export type VehicleWithCustomersDto = z.infer<typeof vehicleWithCustomersSchema>;

// VIN, plate, and most descriptive fields are optional — but a vehicle with
// neither a VIN nor a plate is unidentifiable. Force at least one.
export const createVehicleSchema = z
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
      .pipe(plateStateSchema)
      .optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    make: z.string().max(60).optional(),
    model: z.string().max(120).optional(),
    trim: z.string().max(120).optional(),
    color: z.string().max(60).optional(),
    bodyClass: z.string().max(120).optional(),
    vehicleClass: z.enum(vehicleClassValues).default('unknown'),
    drivetrain: z.enum(drivetrainValues).default('unknown'),
    isElectric: z.boolean().optional(),
    isLowClearance: z.boolean().optional(),
    specialInstructions: z.string().max(2000).optional(),
    defaultCustomerId: z.string().uuid().optional(),
  })
  .refine((v) => v.vin !== undefined || v.plate !== undefined, {
    message: 'Either VIN or plate is required',
    path: ['vin'],
  });
export type CreateVehiclePayload = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    vin: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(vinSchema)
      .nullable()
      .optional(),
    plate: z.string().max(20).nullable().optional(),
    plateState: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(plateStateSchema)
      .nullable()
      .optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    make: z.string().max(60).nullable().optional(),
    model: z.string().max(120).nullable().optional(),
    trim: z.string().max(120).nullable().optional(),
    color: z.string().max(60).nullable().optional(),
    bodyClass: z.string().max(120).nullable().optional(),
    vehicleClass: z.enum(vehicleClassValues).optional(),
    drivetrain: z.enum(drivetrainValues).optional(),
    isElectric: z.boolean().optional(),
    isLowClearance: z.boolean().optional(),
    specialInstructions: z.string().max(2000).nullable().optional(),
    defaultCustomerId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type UpdateVehiclePayload = z.infer<typeof updateVehicleSchema>;

export const vehicleFiltersSchema = z.object({
  q: z.string().max(120).optional(),
  make: z.string().max(60).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  vehicleClass: z.enum(vehicleClassValues).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type VehicleFilters = z.infer<typeof vehicleFiltersSchema>;

export const vehicleSearchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type VehicleSearchQuery = z.infer<typeof vehicleSearchQuerySchema>;

// Plate-or-VIN lookup. Exactly one must be supplied.
export const vehicleLookupSchema = z
  .object({
    plate: z.string().max(20).optional(),
    state: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(plateStateSchema)
      .optional(),
    vin: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(vinSchema)
      .optional(),
  })
  .refine((v) => (v.vin !== undefined) !== (v.plate !== undefined && v.state !== undefined), {
    message: 'Provide either VIN or both plate and state — not both',
  });
export type VehicleLookupQuery = z.infer<typeof vehicleLookupSchema>;

export const paginatedVehiclesSchema = z.object({
  data: z.array(vehicleSchema),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PaginatedVehicles = z.infer<typeof paginatedVehiclesSchema>;

export const linkCustomerVehicleSchema = z.object({
  relationship: z.enum(['owner', 'driver', 'authorized_user']).default('owner'),
  isPrimary: z.boolean().optional(),
});
export type LinkCustomerVehiclePayload = z.infer<typeof linkCustomerVehicleSchema>;
