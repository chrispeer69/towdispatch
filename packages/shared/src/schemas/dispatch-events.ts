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
  // Session 9 — tracking link lifecycle. Dispatch board listens so the
  // small "Tracking" badge on the job card stays current.
  TRACKING_LINK_CREATED: 'tracking.link_created',
  TRACKING_LINK_UPDATED: 'tracking.link_updated',
  TRACKING_LINK_VIEWED: 'tracking.link_viewed',
  TRACKING_MESSAGE_RECEIVED: 'tracking.message_received',
  // Session 29 — impound lifecycle. Emitted by ImpoundService so the Public
  // API webhook publisher can fan them out to subscribed endpoints.
  IMPOUND_OPENED: 'impound.opened',
  IMPOUND_RELEASED: 'impound.released',
  // Session 58 — CADS. truck.service_changed fires when a truck goes in/out
  // of service (capacity recompute trigger + fleet UIs); capacity.status_changed
  // carries the full recomputed per-class status for the dispatch widget.
  TRUCK_SERVICE_CHANGED: 'truck.service_changed',
  CAPACITY_STATUS_CHANGED: 'capacity.status_changed',
} as const;
export type DispatchEventName = (typeof DISPATCH_EVENTS)[keyof typeof DISPATCH_EVENTS];

export const trackingLinkSummaryEventSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  trackingLinkId: z.string().uuid(),
  smsStatus: z.string(),
  firstViewedAt: z.string().datetime().nullable(),
  lastViewedAt: z.string().datetime().nullable(),
  viewCount: z.number().int(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type TrackingLinkSummaryEvent = z.infer<typeof trackingLinkSummaryEventSchema>;

export const trackingMessageReceivedEventSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  messageId: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound', 'system']),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type TrackingMessageReceivedEvent = z.infer<typeof trackingMessageReceivedEventSchema>;

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

export const impoundOpenedEventSchema = z.object({
  impoundRecordId: z.string().uuid(),
  yardId: z.string().uuid(),
  status: z.string(),
  vehicleVin: z.string().nullable(),
  licensePlate: z.string().nullable(),
  arrivedAt: z.string().datetime(),
});
export type ImpoundOpenedEvent = z.infer<typeof impoundOpenedEventSchema>;

export const impoundReleasedEventSchema = z.object({
  impoundRecordId: z.string().uuid(),
  releasedToName: z.string(),
  releasedToType: z.string(),
  totalFeesCents: z.number().int(),
  releasedAt: z.string().datetime(),
});
export type ImpoundReleasedEvent = z.infer<typeof impoundReleasedEventSchema>;
