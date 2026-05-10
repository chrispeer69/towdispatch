/**
 * Driver / truck / driver-shift contracts shared between API and Web.
 * The schemas here describe what the dispatch board reads and writes.
 */
import { z } from 'zod';

export const driverCdlClassValues = ['none', 'A', 'B', 'C'] as const;
export type DriverCdlClass = (typeof driverCdlClassValues)[number];

export const driverShiftStatusValues = [
  'available',
  'en_route',
  'on_scene',
  'in_progress',
  'returning',
  'break',
] as const;
export type DriverShiftStatus = (typeof driverShiftStatusValues)[number];

export const truckTypeValues = [
  'light_duty',
  'medium_duty',
  'heavy_duty',
  'flatbed',
  'wheel_lift',
  'service',
  'other',
] as const;
export type TruckType = (typeof truckTypeValues)[number];

export const driverSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  employeeNumber: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  cdlClass: z.enum(driverCdlClassValues),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DriverDto = z.infer<typeof driverSchema>;

export const truckSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  unitNumber: z.string(),
  truckType: z.enum(truckTypeValues),
  year: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  plate: z.string().nullable(),
  plateState: z.string().nullable(),
  vin: z.string().nullable(),
  inService: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TruckDto = z.infer<typeof truckSchema>;

export const driverShiftSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  truckId: z.string().uuid().nullable(),
  status: z.enum(driverShiftStatusValues),
  currentJobId: z.string().uuid().nullable(),
  lastLat: z.number().nullable(),
  lastLng: z.number().nullable(),
  lastPositionAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
export type DriverShiftDto = z.infer<typeof driverShiftSchema>;

/**
 * The roster row the dispatch board renders. Joins driver + active shift +
 * truck + the job (if any) the driver is currently on.
 */
export const driverRosterRowSchema = z.object({
  driver: driverSchema,
  shift: driverShiftSchema.nullable(),
  truck: truckSchema.nullable(),
  currentJobNumber: z.string().nullable(),
});
export type DriverRosterRow = z.infer<typeof driverRosterRowSchema>;

export const startShiftSchema = z.object({
  driverId: z.string().uuid(),
  truckId: z.string().uuid().optional(),
});
export type StartShiftPayload = z.infer<typeof startShiftSchema>;

export const endShiftSchema = z.object({
  shiftId: z.string().uuid(),
});
export type EndShiftPayload = z.infer<typeof endShiftSchema>;

export const updateShiftStatusSchema = z.object({
  status: z.enum(driverShiftStatusValues),
});
export type UpdateShiftStatusPayload = z.infer<typeof updateShiftStatusSchema>;

export const updateShiftLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type UpdateShiftLocationPayload = z.infer<typeof updateShiftLocationSchema>;

export const assignJobSchema = z.object({
  driverId: z.string().uuid(),
  truckId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
});
export type AssignJobPayload = z.infer<typeof assignJobSchema>;

export const unassignJobSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type UnassignJobPayload = z.infer<typeof unassignJobSchema>;

export const jobTransitionSchema = z.object({
  to: z.enum([
    'new',
    'dispatched',
    'enroute',
    'on_scene',
    'in_progress',
    'completed',
    'cancelled',
    'goa',
  ] as const),
  reason: z.string().max(500).optional(),
});
export type JobTransitionPayload = z.infer<typeof jobTransitionSchema>;
