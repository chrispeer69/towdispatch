/**
 * Notification system — Session 15 public contracts.
 *
 * Three layers:
 *
 *   1. Event catalog — the stable enum every dispatcher caller picks from.
 *      Adding a new event means: append to NOTIFICATION_EVENTS, add a default
 *      template per supported channel, document in docs/notifications.md.
 *
 *   2. Dispatch payload — the body of POST /internal/notifications/dispatch.
 *      Permissive on `payload` because the template variables vary per event;
 *      strict on routing fields.
 *
 *   3. DTOs surfaced to the web and Android clients (in-app entries,
 *      preferences UI, dead-letter inspector).
 *
 * Every channel + priority + status value is exported as a const tuple so
 * Zod validation, RLS check constraints, and the TS types all agree.
 */
import { z } from 'zod';

/* ============================================================
 * Event catalog
 * ============================================================ */

/**
 * Every event type the dispatcher accepts. Phase 1 surface — Phase 2/3
 * additions append at the bottom and never reorder.
 */
export const NOTIFICATION_EVENTS = {
  // Dispatch events
  JOB_ASSIGNED: 'dispatch.job_assigned',
  JOB_ACCEPTED: 'dispatch.job_accepted',
  JOB_DECLINED: 'dispatch.job_declined',
  JOB_STATUS_CHANGED: 'dispatch.job_status_changed',
  JOB_GOA_FLAGGED: 'dispatch.job_goa_flagged',
  JOB_CANCELLED_BY_CUSTOMER: 'dispatch.job_cancelled_by_customer',

  // Motor club events
  MOTOR_CLUB_JOB_RECEIVED: 'motor_club.job_received',
  MOTOR_CLUB_ETA_PUSHED: 'motor_club.eta_pushed',
  MOTOR_CLUB_SYNC_FAILURE: 'motor_club.sync_failure',

  // Customer-facing events
  CUSTOMER_TOW_DISPATCHED: 'customer.tow_dispatched',
  CUSTOMER_DRIVER_EN_ROUTE: 'customer.driver_en_route',
  CUSTOMER_DRIVER_ARRIVED: 'customer.driver_arrived',
  CUSTOMER_PAYMENT_RECEIPT: 'customer.payment_receipt',

  // Billing events
  BILLING_INVOICE_CREATED: 'billing.invoice_created',
  BILLING_INVOICE_PAID: 'billing.invoice_paid',
  BILLING_PAYMENT_FAILED: 'billing.payment_failed',
  BILLING_CARD_EXPIRING: 'billing.card_on_file_expiring',

  // Compliance events
  COMPLIANCE_LICENSE_EXPIRING: 'compliance.driver_license_expiring',
  COMPLIANCE_MEDICAL_CARD_EXPIRING: 'compliance.medical_card_expiring',
  COMPLIANCE_COI_EXPIRING: 'compliance.coi_expiring',
  COMPLIANCE_MOTOR_CLUB_CRED_EXPIRING: 'compliance.motor_club_credential_expiring',
  COMPLIANCE_DVIR_DEFECT_FLAGGED: 'compliance.dvir_defect_flagged',

  // System events
  SYSTEM_REPORT_SCHEDULED_DELIVERY: 'system.scheduled_report_delivery',
  SYSTEM_INTEGRATION_AUTH_FAILURE: 'system.integration_auth_failure',
  SYSTEM_SECURITY_EVENT: 'system.security_event',

  // Operational (Phase 3 — schema-wired, not all firing yet)
  OPS_LIEN_DEADLINE_APPROACHING: 'operational.lien_deadline_approaching',
  OPS_HOLD_VEHICLE_RELEASE_APPROVED: 'operational.hold_vehicle_release_approved',
  OPS_AUCTION_LOT_EXPIRING: 'operational.auction_lot_expiring',
} as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
export const NOTIFICATION_EVENT_VALUES = Object.values(NOTIFICATION_EVENTS) as readonly NotificationEvent[];

export const NOTIFICATION_EVENT_CATEGORY = {
  DISPATCH: 'dispatch',
  MOTOR_CLUB: 'motor_club',
  CUSTOMER: 'customer',
  BILLING: 'billing',
  COMPLIANCE: 'compliance',
  SYSTEM: 'system',
  OPERATIONAL: 'operational',
  SECURITY: 'security',
} as const;
export type NotificationEventCategory =
  (typeof NOTIFICATION_EVENT_CATEGORY)[keyof typeof NOTIFICATION_EVENT_CATEGORY];
export const NOTIFICATION_EVENT_CATEGORY_VALUES = Object.values(
  NOTIFICATION_EVENT_CATEGORY,
) as readonly NotificationEventCategory[];

/** Maps every event to its category — drives the preferences matrix. */
export const EVENT_CATEGORY_BY_EVENT: Record<NotificationEvent, NotificationEventCategory> = {
  [NOTIFICATION_EVENTS.JOB_ASSIGNED]: 'dispatch',
  [NOTIFICATION_EVENTS.JOB_ACCEPTED]: 'dispatch',
  [NOTIFICATION_EVENTS.JOB_DECLINED]: 'dispatch',
  [NOTIFICATION_EVENTS.JOB_STATUS_CHANGED]: 'dispatch',
  [NOTIFICATION_EVENTS.JOB_GOA_FLAGGED]: 'dispatch',
  [NOTIFICATION_EVENTS.JOB_CANCELLED_BY_CUSTOMER]: 'dispatch',

  [NOTIFICATION_EVENTS.MOTOR_CLUB_JOB_RECEIVED]: 'motor_club',
  [NOTIFICATION_EVENTS.MOTOR_CLUB_ETA_PUSHED]: 'motor_club',
  [NOTIFICATION_EVENTS.MOTOR_CLUB_SYNC_FAILURE]: 'motor_club',

  [NOTIFICATION_EVENTS.CUSTOMER_TOW_DISPATCHED]: 'customer',
  [NOTIFICATION_EVENTS.CUSTOMER_DRIVER_EN_ROUTE]: 'customer',
  [NOTIFICATION_EVENTS.CUSTOMER_DRIVER_ARRIVED]: 'customer',
  [NOTIFICATION_EVENTS.CUSTOMER_PAYMENT_RECEIPT]: 'customer',

  [NOTIFICATION_EVENTS.BILLING_INVOICE_CREATED]: 'billing',
  [NOTIFICATION_EVENTS.BILLING_INVOICE_PAID]: 'billing',
  [NOTIFICATION_EVENTS.BILLING_PAYMENT_FAILED]: 'billing',
  [NOTIFICATION_EVENTS.BILLING_CARD_EXPIRING]: 'billing',

  [NOTIFICATION_EVENTS.COMPLIANCE_LICENSE_EXPIRING]: 'compliance',
  [NOTIFICATION_EVENTS.COMPLIANCE_MEDICAL_CARD_EXPIRING]: 'compliance',
  [NOTIFICATION_EVENTS.COMPLIANCE_COI_EXPIRING]: 'compliance',
  [NOTIFICATION_EVENTS.COMPLIANCE_MOTOR_CLUB_CRED_EXPIRING]: 'compliance',
  [NOTIFICATION_EVENTS.COMPLIANCE_DVIR_DEFECT_FLAGGED]: 'compliance',

  [NOTIFICATION_EVENTS.SYSTEM_REPORT_SCHEDULED_DELIVERY]: 'system',
  [NOTIFICATION_EVENTS.SYSTEM_INTEGRATION_AUTH_FAILURE]: 'system',
  [NOTIFICATION_EVENTS.SYSTEM_SECURITY_EVENT]: 'security',

  [NOTIFICATION_EVENTS.OPS_LIEN_DEADLINE_APPROACHING]: 'operational',
  [NOTIFICATION_EVENTS.OPS_HOLD_VEHICLE_RELEASE_APPROVED]: 'operational',
  [NOTIFICATION_EVENTS.OPS_AUCTION_LOT_EXPIRING]: 'operational',
};

/* ============================================================
 * Channels / priority / status
 * ============================================================ */

export const NOTIFICATION_CHANNEL_VALUES = [
  'push',
  'sms',
  'email',
  'in_app',
  'webhook',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number];

export const NOTIFICATION_PRIORITY_VALUES = ['emergency', 'high', 'normal', 'low'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITY_VALUES)[number];

export const NOTIFICATION_STATUS_VALUES = [
  'pending',
  'dispatched',
  'partially_failed',
  'failed',
  'delivered',
  'cancelled',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS_VALUES)[number];

export const NOTIFICATION_DELIVERY_STATUS_VALUES = [
  'queued',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'suppressed',
  'dead_lettered',
] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

/* ============================================================
 * Dispatch input
 * ============================================================ */

/**
 * Always-on event types that ignore quiet hours by default. Per-user
 * preferences may add to this list but not remove from it.
 */
export const DEFAULT_QUIET_HOURS_OVERRIDES: readonly NotificationEvent[] = [
  NOTIFICATION_EVENTS.MOTOR_CLUB_JOB_RECEIVED,
  NOTIFICATION_EVENTS.JOB_ASSIGNED,
  NOTIFICATION_EVENTS.JOB_GOA_FLAGGED,
  NOTIFICATION_EVENTS.SYSTEM_SECURITY_EVENT,
  NOTIFICATION_EVENTS.COMPLIANCE_DVIR_DEFECT_FLAGGED,
];

export const notificationRecipientSchema = z
  .object({
    userId: z.string().uuid().optional(),
    /** "role:dispatcher" | "role:owner,admin" | "role:driver" — comma-separated roles. */
    roleScope: z
      .string()
      .regex(/^role:[a-z,]+$/, 'roleScope must look like role:dispatcher or role:owner,admin')
      .optional(),
  })
  .refine((r) => !!(r.userId || r.roleScope), {
    message: 'recipient.userId or recipient.roleScope is required',
  });

export type NotificationRecipientInput = z.infer<typeof notificationRecipientSchema>;

export const dispatchNotificationSchema = z.object({
  recipient: notificationRecipientSchema,
  eventType: z.enum(NOTIFICATION_EVENT_VALUES as unknown as [NotificationEvent, ...NotificationEvent[]]),
  templateKey: z.string().min(1).optional(),
  payload: z.record(z.unknown()).default({}),
  channels: z
    .union([
      z.literal('auto'),
      z.array(z.enum(NOTIFICATION_CHANNEL_VALUES)).min(1),
    ])
    .default('auto'),
  priority: z.enum(NOTIFICATION_PRIORITY_VALUES).default('normal'),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type DispatchNotificationPayload = z.infer<typeof dispatchNotificationSchema>;

export const dispatchNotificationResultSchema = z.object({
  notificationId: z.string().uuid(),
  status: z.enum(NOTIFICATION_STATUS_VALUES),
  deduplicated: z.boolean(),
  channels: z.array(
    z.object({
      channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
      status: z.enum(NOTIFICATION_DELIVERY_STATUS_VALUES),
      suppressionReason: z.string().nullable(),
    }),
  ),
});

export type DispatchNotificationResult = z.infer<typeof dispatchNotificationResultSchema>;

/* ============================================================
 * Preferences DTOs
 * ============================================================ */

export const preferencesMatrixCellSchema = z.object({
  eventCategory: z.string(),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  enabled: z.boolean(),
});

export const userPreferencesDtoSchema = z.object({
  userId: z.string().uuid(),
  preferences: z.array(preferencesMatrixCellSchema),
  quietHours: z.object({
    enabled: z.boolean(),
    startLocal: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
    endLocal: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
    timezone: z.string(),
    overrideEventTypes: z.array(z.string()),
  }),
});

export type UserPreferencesDto = z.infer<typeof userPreferencesDtoSchema>;

export const updateUserPreferencesSchema = z.object({
  preferences: z.array(preferencesMatrixCellSchema).optional(),
  quietHours: z
    .object({
      enabled: z.boolean(),
      startLocal: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
      endLocal: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
      timezone: z.string(),
      overrideEventTypes: z.array(z.string()),
    })
    .optional(),
});
export type UpdateUserPreferencesPayload = z.infer<typeof updateUserPreferencesSchema>;

export const tenantDefaultPreferencesSchema = z.object({
  preferences: z.array(preferencesMatrixCellSchema),
});
export type TenantDefaultPreferencesPayload = z.infer<typeof tenantDefaultPreferencesSchema>;

/* ============================================================
 * In-app entries
 * ============================================================ */

export const inAppNotificationDtoSchema = z.object({
  id: z.string().uuid(),
  notificationId: z.string().uuid(),
  eventType: z.string(),
  category: z.string(),
  priority: z.enum(NOTIFICATION_PRIORITY_VALUES),
  subject: z.string().nullable(),
  body: z.string(),
  payload: z.record(z.unknown()),
  status: z.enum(NOTIFICATION_DELIVERY_STATUS_VALUES),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  channelSummaries: z.array(
    z.object({
      channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
      status: z.enum(NOTIFICATION_DELIVERY_STATUS_VALUES),
    }),
  ),
});
export type InAppNotificationDto = z.infer<typeof inAppNotificationDtoSchema>;

export const notificationListQuerySchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES).optional(),
  eventType: z.string().optional(),
  status: z.enum(NOTIFICATION_DELIVERY_STATUS_VALUES).optional(),
  unreadOnly: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/* ============================================================
 * Templates
 * ============================================================ */

export const notificationTemplateDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  templateKey: z.string(),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  subject: z.string().nullable(),
  body: z.string(),
  bodyPlain: z.string().nullable(),
  variablesSchema: z.array(z.unknown()),
  active: z.boolean(),
  isOverride: z.boolean(),
});
export type NotificationTemplateDto = z.infer<typeof notificationTemplateDtoSchema>;

export const upsertTemplateSchema = z.object({
  templateKey: z.string().min(1).max(128),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  subject: z.string().max(998).nullable().optional(),
  body: z.string().min(1).max(20_000),
  bodyPlain: z.string().max(20_000).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpsertTemplatePayload = z.infer<typeof upsertTemplateSchema>;

export const previewTemplateSchema = z.object({
  templateKey: z.string(),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  payload: z.record(z.unknown()).default({}),
});
export type PreviewTemplatePayload = z.infer<typeof previewTemplateSchema>;

/* ============================================================
 * Webhook subscriptions
 * ============================================================ */

export const webhookSubscriptionDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  endpointUrl: z.string().url(),
  eventTypes: z.array(z.string()),
  active: z.boolean(),
  /** Secret returned ONLY on create + rotate. List view returns null. */
  secret: z.string().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  lastFailureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type WebhookSubscriptionDto = z.infer<typeof webhookSubscriptionDtoSchema>;

export const upsertWebhookSubscriptionSchema = z.object({
  name: z.string().min(1).max(120),
  endpointUrl: z.string().url(),
  eventTypes: z.array(z.string().min(1)).min(1),
  active: z.boolean().optional(),
});
export type UpsertWebhookSubscriptionPayload = z.infer<typeof upsertWebhookSubscriptionSchema>;

export const webhookDeliveryDtoSchema = z.object({
  id: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  eventType: z.string(),
  status: z.enum(NOTIFICATION_DELIVERY_STATUS_VALUES),
  attemptCount: z.number().int(),
  responseCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WebhookDeliveryDto = z.infer<typeof webhookDeliveryDtoSchema>;

/* ============================================================
 * Dead letters
 * ============================================================ */

export const deadLetterDtoSchema = z.object({
  id: z.string().uuid(),
  notificationId: z.string().uuid().nullable(),
  deliveryId: z.string().uuid().nullable(),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  failureReason: z.string(),
  attemptCount: z.number().int(),
  retriedAt: z.string().datetime().nullable(),
  payloadSnapshot: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type DeadLetterDto = z.infer<typeof deadLetterDtoSchema>;

/* ============================================================
 * Delivery metrics (admin dashboard)
 * ============================================================ */

export const deliveryMetricsBucketSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  bounced: z.number().int(),
  suppressed: z.number().int(),
});
export const deliveryMetricsSchema = z.object({
  windowDays: z.number().int(),
  buckets: z.array(deliveryMetricsBucketSchema),
  totals: z.object({
    sent: z.number().int(),
    delivered: z.number().int(),
    failed: z.number().int(),
    bounced: z.number().int(),
    suppressed: z.number().int(),
    deadLettered: z.number().int(),
  }),
});
export type DeliveryMetrics = z.infer<typeof deliveryMetricsSchema>;

/* ============================================================
 * Driver-side pending-jobs fallback contract
 * ============================================================ */

export const driverPendingJobDtoSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  status: z.string(),
  serviceType: z.string(),
  pickup: z.object({
    address: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  }),
  customerName: z.string().nullable(),
  assignedAt: z.string().datetime(),
  priorityLabel: z.string(),
});
export type DriverPendingJobDto = z.infer<typeof driverPendingJobDtoSchema>;

export const driverPendingJobsResponseSchema = z.object({
  jobs: z.array(driverPendingJobDtoSchema),
  serverTime: z.string().datetime(),
});

/* ============================================================
 * Device token registration (driver app)
 * ============================================================ */

export const registerDeviceTokenSchema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  token: z.string().min(8),
  deviceId: z.string().min(1).max(200),
  appVersion: z.string().max(40).optional(),
});
export type RegisterDeviceTokenPayload = z.infer<typeof registerDeviceTokenSchema>;
