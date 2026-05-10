/**
 * Tracking module contracts — shared between API, web, and the customer
 * tracking page. Token-shaped strings are validated by length + character set
 * rather than as URL fragments because the public route receives them as
 * params, not URLs.
 */
import { z } from 'zod';

/** Friendly status labels shown to the customer. */
export const trackingStatusLabelsEn = {
  new: 'Request received',
  dispatched: 'Driver assigned',
  enroute: 'On the way',
  on_scene: 'On scene',
  in_progress: 'Loaded, in transit',
  completed: 'Delivered',
  cancelled: 'Cancelled',
  goa: 'Driver arrived — service not needed',
} as const;

export const trackingStatusLabelsEs = {
  new: 'Solicitud recibida',
  dispatched: 'Conductor asignado',
  enroute: 'En camino',
  on_scene: 'En el lugar',
  in_progress: 'Cargado, en tránsito',
  completed: 'Entregado',
  cancelled: 'Cancelado',
  goa: 'Conductor llegó — servicio no necesario',
} as const;

export type TrackingLanguage = 'en' | 'es';

export function trackingStatusLabel(
  status: keyof typeof trackingStatusLabelsEn,
  lang: TrackingLanguage = 'en',
): string {
  return lang === 'es' ? trackingStatusLabelsEs[status] : trackingStatusLabelsEn[status];
}

/** A token is base64url encoded, 22-44 chars (we generate 32). */
export const trackingTokenSchema = z
  .string()
  .min(22)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'invalid_token_chars');

export const sendTrackingMessageSchema = z.object({
  body: z.string().min(1).max(1000),
});
export type SendTrackingMessagePayload = z.infer<typeof sendTrackingMessageSchema>;

export const submitJobRatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().nullable(),
});
export type SubmitJobRatingPayload = z.infer<typeof submitJobRatingSchema>;

export const resendTrackingSmsSchema = z.object({
  /** Allow dispatcher to override the destination — defaults to customer.phone. */
  to: z.string().min(7).max(20).optional(),
});
export type ResendTrackingSmsPayload = z.infer<typeof resendTrackingSmsSchema>;

export const trackingPublicViewSchema = z.object({
  jobNumber: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  serviceType: z.string(),
  pickupAddress: z.string(),
  dropoffAddress: z.string().nullable(),
  driver: z
    .object({
      firstName: z.string(),
      photoUrl: z.string().nullable(),
      truckUnitNumber: z.string().nullable(),
    })
    .nullable(),
  driverLocation: z
    .object({
      lat: z.number(),
      lng: z.number(),
      recordedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  pickup: z
    .object({
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    })
    .nullable(),
  vehicle: z
    .object({
      year: z.number().nullable(),
      make: z.string().nullable(),
      model: z.string().nullable(),
    })
    .nullable(),
  tenant: z.object({
    name: z.string(),
    logoUrl: z.string().nullable(),
    primaryColor: z.string().nullable(),
    accentColor: z.string().nullable(),
    dispatchPhone: z.string().nullable(),
  }),
  language: z.enum(['en', 'es']),
  ratingSubmitted: z.boolean(),
  expired: z.boolean(),
  completed: z.boolean(),
});
export type TrackingPublicView = z.infer<typeof trackingPublicViewSchema>;

export const trackingMessageDtoSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound', 'system']),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type TrackingMessageDto = z.infer<typeof trackingMessageDtoSchema>;

export const trackingLinkDtoSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  token: z.string(),
  url: z.string().url(),
  smsStatus: z.enum(['pending', 'queued', 'sent', 'delivered', 'failed', 'skipped']),
  smsToPhone: z.string().nullable(),
  smsSentAt: z.string().datetime().nullable(),
  smsDeliveredAt: z.string().datetime().nullable(),
  smsFailedReason: z.string().nullable(),
  firstViewedAt: z.string().datetime().nullable(),
  lastViewedAt: z.string().datetime().nullable(),
  viewCount: z.number().int(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type TrackingLinkDto = z.infer<typeof trackingLinkDtoSchema>;

export const TRACKING_EVENTS = {
  STATUS_CHANGED: 'tracking.status_changed',
  DRIVER_LOCATION: 'tracking.driver_location',
  MESSAGE_FROM_DISPATCH: 'tracking.message_from_dispatch',
  MESSAGE_FROM_CUSTOMER: 'tracking.message_from_customer',
  EXPIRED: 'tracking.expired',
} as const;
export type TrackingEventName = (typeof TRACKING_EVENTS)[keyof typeof TRACKING_EVENTS];
