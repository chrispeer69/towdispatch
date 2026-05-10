/**
 * Dispatch-board contracts: driver shifts, roster row, and shift/job
 * lifecycle payloads.
 *
 * The long-form driver/truck DTOs (with license, certifications, equipment,
 * etc.) live in ./fleet.ts — that file is the single source of truth for
 * the row shapes. This file owns only the dispatch-only objects that
 * fleet.ts intentionally doesn't redefine: live shifts, the roster row, and
 * the shift/job control payloads the Session-5 dispatch board uses.
 *
 * Session 8 merge note: prior to merge this file also exported driverSchema,
 * truckSchema, driverCdlClassValues, truckTypeValues, and the basic
 * DriverDto/TruckDto. Those overlapped with fleet.ts (the superset) and were
 * removed during the Session-5↔Session-8 merge. Dispatch consumers that
 * imported them now resolve to the fleet.ts versions instead.
 */
import { z } from 'zod';
import { driverSchema, truckSchema } from './fleet';

export const driverShiftStatusValues = [
  'available',
  'en_route',
  'on_scene',
  'in_progress',
  'returning',
  'break',
] as const;
export type DriverShiftStatus = (typeof driverShiftStatusValues)[number];

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
