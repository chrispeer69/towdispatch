/**
 * Socket.IO event payload contracts. Names mirror the literal event-type
 * strings the gateway emits. Each payload is small and self-contained so
 * the dispatch UI can apply optimistic updates from a single message.
 */
import { z } from 'zod';
import { jobSchema } from './job';

export const DISPATCH_EVENTS = {
  JOB_CREATED: 'job.created',
  JOB_ASSIGNED: 'job.assigned',
  JOB_UNASSIGNED: 'job.unassigned',
  JOB_STATUS_CHANGED: 'job.status_changed',
  DRIVER_LOCATION_CHANGED: 'driver.location_changed',
  DRIVER_SHIFT_STARTED: 'driver.shift_started',
  DRIVER_SHIFT_ENDED: 'driver.shift_ended',
  DRIVER_STATUS_CHANGED: 'driver.status_changed',
} as const;
export type DispatchEventName = (typeof DISPATCH_EVENTS)[keyof typeof DISPATCH_EVENTS];

export const jobCreatedEventSchema = z.object({
  job: jobSchema,
});
export type JobCreatedEvent = z.infer<typeof jobCreatedEventSchema>;

export const jobAssignedEventSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  status: z.string(),
  driverId: z.string().uuid(),
  truckId: z.string().uuid().nullable(),
  shiftId: z.string().uuid().nullable(),
  assignedByUserId: z.string().uuid(),
  /** Used when the dispatcher dragged from one driver to another. */
  previousDriverId: z.string().uuid().nullable(),
});
export type JobAssignedEvent = z.infer<typeof jobAssignedEventSchema>;

export const jobUnassignedEventSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  previousDriverId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  unassignedByUserId: z.string().uuid(),
});
export type JobUnassignedEvent = z.infer<typeof jobUnassignedEventSchema>;

export const jobStatusChangedEventSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  fromStatus: z.string(),
  toStatus: z.string(),
  actorUserId: z.string().uuid().nullable(),
});
export type JobStatusChangedEvent = z.infer<typeof jobStatusChangedEventSchema>;

export const driverLocationChangedEventSchema = z.object({
  shiftId: z.string().uuid(),
  driverId: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  recordedAt: z.string().datetime(),
});
export type DriverLocationChangedEvent = z.infer<typeof driverLocationChangedEventSchema>;

export const driverShiftStartedEventSchema = z.object({
  shiftId: z.string().uuid(),
  driverId: z.string().uuid(),
  truckId: z.string().uuid().nullable(),
  startedAt: z.string().datetime(),
});
export type DriverShiftStartedEvent = z.infer<typeof driverShiftStartedEventSchema>;

export const driverShiftEndedEventSchema = z.object({
  shiftId: z.string().uuid(),
  driverId: z.string().uuid(),
  endedAt: z.string().datetime(),
});
export type DriverShiftEndedEvent = z.infer<typeof driverShiftEndedEventSchema>;

export const driverStatusChangedEventSchema = z.object({
  shiftId: z.string().uuid(),
  driverId: z.string().uuid(),
  status: z.string(),
});
export type DriverStatusChangedEvent = z.infer<typeof driverStatusChangedEventSchema>;
