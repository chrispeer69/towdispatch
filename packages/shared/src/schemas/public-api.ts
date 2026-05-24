/**
 * Public REST API + Webhooks — Zod contracts (Session 29).
 *
 * Single source of truth shared by the API (validation + DTO mapping), the
 * web settings UI (key/webhook management), and the docs. Three surfaces:
 *   1. API-key + webhook-endpoint management (operator-facing, session-auth'd)
 *   2. The /v1 public resource DTOs (consumer-facing, API-key-auth'd)
 *   3. Cursor pagination + webhook event catalog
 *
 * Secrets (the full API key, the webhook signing secret) cross the wire
 * exactly once, in the *Result schemas at creation, and are never returned
 * again — the persisted DTOs omit them.
 */
import { z } from 'zod';
import { jobStatusValues } from './job';

// ----------------------------------------------------------------------
// Scopes — the permission grid an API key carries. Stringly-typed scope
// literals are avoided at every call site by importing apiScopeValues.
// ----------------------------------------------------------------------

export const apiScopeValues = [
  'jobs:read',
  'jobs:write',
  'trucks:read',
  'drivers:read',
  'impound:read',
] as const;
export type ApiScope = (typeof apiScopeValues)[number];

// ----------------------------------------------------------------------
// Webhook event catalog (v1). Each value is both the event_type stored on
// a delivery and the subscription token on an endpoint.
// ----------------------------------------------------------------------

export const webhookEventTypeValues = [
  'job.created',
  'job.status_changed',
  'impound.opened',
  'impound.released',
] as const;
export type WebhookEventType = (typeof webhookEventTypeValues)[number];

// ----------------------------------------------------------------------
// Cursor pagination
// ----------------------------------------------------------------------

/**
 * Opaque keyset cursor. We encode the last row's UUIDv7 id; because v7 is
 * time-sortable, "id < cursor" walks strictly backwards in creation order.
 */
export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(256).optional(),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ----------------------------------------------------------------------
// API key management (operator-facing)
// ----------------------------------------------------------------------

export const apiKeySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(apiScopeValues)),
  rateLimitPerMin: z.number().int().positive(),
  createdBy: z.string().uuid(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ApiKeyDto = z.infer<typeof apiKeySchema>;

export const createApiKeySchema = z
  .object({
    name: z.string().min(1).max(120),
    scopes: z.array(z.enum(apiScopeValues)).min(1).max(apiScopeValues.length),
    rateLimitPerMin: z.number().int().min(1).max(100_000).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateApiKeyPayload = z.infer<typeof createApiKeySchema>;

/** Returned ONCE on creation. `plaintextKey` is never persisted or re-shown. */
export const createApiKeyResultSchema = z.object({
  apiKey: apiKeySchema,
  plaintextKey: z.string(),
});
export type CreateApiKeyResult = z.infer<typeof createApiKeyResultSchema>;

// ----------------------------------------------------------------------
// Webhook endpoint management (operator-facing)
// ----------------------------------------------------------------------

export const webhookEndpointSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  url: z.string().url(),
  description: z.string().nullable(),
  events: z.array(z.enum(webhookEventTypeValues)),
  active: z.boolean(),
  createdBy: z.string().uuid(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WebhookEndpointDto = z.infer<typeof webhookEndpointSchema>;

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'Webhook URL must be https://' })
  .refine((u) => u.length <= 2048, { message: 'Webhook URL too long' });

export const createWebhookEndpointSchema = z
  .object({
    url: httpsUrl,
    description: z.string().max(500).optional(),
    events: z.array(z.enum(webhookEventTypeValues)).min(1).max(webhookEventTypeValues.length),
  })
  .strict();
export type CreateWebhookEndpointPayload = z.infer<typeof createWebhookEndpointSchema>;

export const updateWebhookEndpointSchema = z
  .object({
    url: httpsUrl.optional(),
    description: z.string().max(500).nullable().optional(),
    events: z
      .array(z.enum(webhookEventTypeValues))
      .min(1)
      .max(webhookEventTypeValues.length)
      .optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateWebhookEndpointPayload = z.infer<typeof updateWebhookEndpointSchema>;

/** Returned ONCE on creation. `signingSecret` is never re-shown. */
export const createWebhookEndpointResultSchema = z.object({
  endpoint: webhookEndpointSchema,
  signingSecret: z.string(),
});
export type CreateWebhookEndpointResult = z.infer<typeof createWebhookEndpointResultSchema>;

// ----------------------------------------------------------------------
// Webhook deliveries (operator-facing log)
// ----------------------------------------------------------------------

export const webhookDeliveryStatusValues = [
  'pending',
  'delivering',
  'delivered',
  'failed',
] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatusValues)[number];

export const webhookDeliverySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  endpointId: z.string().uuid(),
  eventType: z.string(),
  eventId: z.string().uuid().nullable(),
  payload: z.unknown(),
  status: z.enum(webhookDeliveryStatusValues),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextRetryAt: z.string().datetime().nullable(),
  responseCode: z.number().int().nullable(),
  responseBody: z.string().nullable(),
  lastError: z.string().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;

// ----------------------------------------------------------------------
// /v1 public resource DTOs — deliberately trimmed + stable. Internal fields
// (tenantId is implied by the key; tier-offer linkage, rate breakdown, soft-
// delete bookkeeping) are intentionally omitted so the public contract does
// not churn with internal schema changes.
// ----------------------------------------------------------------------

export const publicJobSchema = z.object({
  id: z.string().uuid(),
  jobNumber: z.string(),
  status: z.enum(jobStatusValues),
  serviceType: z.string(),
  pickupAddress: z.string(),
  dropoffAddress: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  vehicleId: z.string().uuid().nullable(),
  assignedDriverId: z.string().uuid().nullable(),
  assignedTruckId: z.string().uuid().nullable(),
  rateQuotedCents: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicJobDto = z.infer<typeof publicJobSchema>;

export const publicJobListQuerySchema = cursorQuerySchema.extend({
  status: z.enum(jobStatusValues).optional(),
});
export type PublicJobListQuery = z.infer<typeof publicJobListQuerySchema>;

export const publicTruckSchema = z.object({
  id: z.string().uuid(),
  unitNumber: z.string(),
  truckType: z.string(),
  status: z.string(),
  inService: z.boolean(),
  // trucks.year is a text column in the schema; keep the public shape faithful.
  year: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  plate: z.string().nullable(),
  plateState: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicTruckDto = z.infer<typeof publicTruckSchema>;

export const publicDriverSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  employmentStatus: z.string(),
  active: z.boolean(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  cdlClass: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicDriverDto = z.infer<typeof publicDriverSchema>;

export const publicImpoundSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  yardId: z.string().uuid(),
  vehicleVin: z.string().nullable(),
  licensePlate: z.string().nullable(),
  vehicleMake: z.string().nullable(),
  vehicleModel: z.string().nullable(),
  vehicleYear: z.number().int().nullable(),
  arrivedAt: z.string().datetime(),
  releasedAt: z.string().datetime().nullable(),
  lienEligible: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicImpoundDto = z.infer<typeof publicImpoundSchema>;

/**
 * POST /v1/jobs body. We reuse the heavy intake contract (createJobIntakeSchema)
 * at the controller so a consumer can create a job from raw customer/vehicle/
 * location data in one call — no prerequisite IDs. PATCH /v1/jobs/:id/status
 * uses the schema below.
 */
export const publicJobStatusPatchSchema = z
  .object({
    status: z.enum(jobStatusValues),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type PublicJobStatusPatch = z.infer<typeof publicJobStatusPatchSchema>;
