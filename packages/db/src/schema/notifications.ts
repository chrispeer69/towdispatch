/**
 * notifications — Session 15, the unified notifications backbone.
 *
 * Every outbound notification (push / SMS / email / in-app / webhook) is
 * persisted as one row in `notifications`. The fan-out per channel is
 * recorded in `notification_deliveries` — one row per channel attempt,
 * with provider message id + status + retry count.
 *
 * Idempotency: (tenant_id, idempotency_key) is a partial unique index. A
 * second dispatch with the same key within the 24h dedup window short-circuits
 * to the original notification id.
 *
 * Tenant isolation: FORCE RLS, every row carries tenant_id. Provider tokens
 * for FCM/APNs live in `notification_device_tokens` — also tenant-scoped so
 * a token registered for tenant A cannot be used to deliver a notification
 * targeted at tenant B (the "kill-switch" requirement in the prompt).
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const notificationPriorityValues = ['emergency', 'high', 'normal', 'low'] as const;
export type NotificationPriority = (typeof notificationPriorityValues)[number];

export const notificationChannelValues = [
  'push',
  'sms',
  'email',
  'in_app',
  'webhook',
] as const;
export type NotificationChannelValue = (typeof notificationChannelValues)[number];

export const notificationStatusValues = [
  'pending', // accepted, not yet enqueued per-channel
  'dispatched', // at least one channel was enqueued
  'partially_failed', // some channels failed
  'failed', // all channels failed
  'delivered', // every fanned-out channel reported delivered/sent
  'cancelled', // killed before any channel fired
] as const;
export type NotificationStatus = (typeof notificationStatusValues)[number];

export const notificationDeliveryStatusValues = [
  'queued',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'suppressed', // quiet-hours / preferences disabled
  'dead_lettered',
] as const;
export type NotificationDeliveryStatus = (typeof notificationDeliveryStatusValues)[number];

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Recipient user. Null when targeting a role-scope (e.g. all dispatchers). */
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Role scope expression — null when recipientUserId is set. Format:
     * "role:dispatcher" / "role:driver" / "role:owner,admin". Service resolves
     * the user list at fan-out time so we have a permanent record of who was
     * targeted on each delivery.
     */
    recipientRoleScope: text('recipient_role_scope'),

    /** Stable enum from notification-events.ts (e.g. job.assigned, billing.invoice_paid). */
    eventType: text('event_type').notNull(),
    /** Lookup key into notification_templates. May differ from event_type if a
     * tenant overrides only one of several templates for an event. */
    templateKey: text('template_key').notNull(),
    /** Raw event payload, used both for template variables and audit. PII is
     * encrypted at rest via the column-level wrapper (Session 11 KMS pattern);
     * for the v1 ship we use jsonb directly and rely on RLS + pino redaction. */
    payload: jsonb('payload').notNull(),

    priority: text('priority', { enum: notificationPriorityValues }).notNull().default('normal'),
    status: text('status', { enum: notificationStatusValues }).notNull().default('pending'),

    /** Explicit channel hint. Null = service decides from preferences. */
    requestedChannels: jsonb('requested_channels'),

    /** Idempotency key. Partial unique on (tenant_id, idempotency_key). */
    idempotencyKey: text('idempotency_key'),

    /** Dedup window — service rejects re-sends within 24h by default. */
    idempotencyExpiresAt: timestamp('idempotency_expires_at', { withTimezone: true }),

    /** When did we first attempt fan-out (post-quiet-hours, post-preferences). */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    /** Final settled state timestamp — every delivery row has terminal status. */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('notifications_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantRecipientIdx: index('notifications_tenant_recipient_idx').on(
      t.tenantId,
      t.recipientUserId,
      t.createdAt,
    ),
    tenantEventIdx: index('notifications_tenant_event_idx').on(t.tenantId, t.eventType),
    // Partial unique is added in sql/0038_notifications.sql.
  }),
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),

    channel: text('channel', { enum: notificationChannelValues }).notNull(),
    /** The user this specific delivery targets — denormalized for indexing/RLS. */
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Provider-resolved address (E.164 phone, email, device token, endpoint URL). Masked in dto. */
    targetAddress: text('target_address'),

    status: text('status', { enum: notificationDeliveryStatusValues }).notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),

    /** Provider's message id (Twilio SID, SendGrid x-message-id, FCM message id). */
    providerMessageId: text('provider_message_id'),
    providerName: text('provider_name'),

    /** Rendered subject (email) or null. */
    renderedSubject: text('rendered_subject'),
    /** Rendered body in the channel's native format. */
    renderedBody: text('rendered_body'),

    lastError: text('last_error'),
    /** Per-channel scheduling — pushed into the future during quiet hours. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),

    /** In-app read state — only meaningful for channel='in_app'. */
    readAt: timestamp('read_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('notification_deliveries_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    notificationIdx: index('notification_deliveries_notification_idx').on(t.notificationId),
    tenantChannelIdx: index('notification_deliveries_tenant_channel_idx').on(
      t.tenantId,
      t.channel,
      t.createdAt,
    ),
    tenantRecipientUnreadIdx: index('notification_deliveries_tenant_recipient_unread_idx').on(
      t.tenantId,
      t.recipientUserId,
      t.readAt,
    ),
    providerLookupIdx: index('notification_deliveries_provider_lookup_idx').on(
      t.providerName,
      t.providerMessageId,
    ),
  }),
);

export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;

/**
 * Per-user preferences.
 *
 * Tenant defaults live as rows with user_id = NULL (one row per
 * (tenant_id, NULL, event_category, channel)). User overrides are full
 * rows; resolver merges user row > tenant default > system default.
 *
 * Quiet hours are stored once per (tenant_id, user_id) — see
 * notification_preferences_quiet_hours below.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Null = tenant-default row. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

    /** Coarse-grained group: dispatch | motor_club | customer | billing | compliance | system | operational | security */
    eventCategory: text('event_category').notNull(),
    channel: text('channel', { enum: notificationChannelValues }).notNull(),

    enabled: boolean('enabled').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The partial unique index ((tenant_id, COALESCE(user_id,0), category, channel))
    // lands in sql/0038_notifications.sql; Drizzle can't express the COALESCE.
    tenantUserIdx: index('notification_preferences_tenant_user_idx').on(
      t.tenantId,
      t.userId,
      t.eventCategory,
    ),
  }),
);

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;

/**
 * Quiet hours + override list — one row per user. Separate from preferences
 * because the matrix table would otherwise duplicate quiet-hours across every
 * (category, channel) row.
 */
export const notificationQuietHours = pgTable(
  'notification_quiet_hours',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    enabled: boolean('enabled').notNull().default(false),
    /** Local time, HH:MM 24h. Interpreted in `timezone`. */
    startLocal: text('start_local').notNull().default('22:00'),
    endLocal: text('end_local').notNull().default('07:00'),
    /** IANA timezone, e.g. America/New_York. */
    timezone: text('timezone').notNull().default('UTC'),

    /** Event types that ignore quiet hours. Stored as jsonb array of strings. */
    overrideEventTypes: jsonb('override_event_types')
      .notNull()
      .$type<string[]>()
      .default([] as string[]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantUserUniq: uniqueIndex('notification_quiet_hours_tenant_user_unique').on(
      t.tenantId,
      t.userId,
    ),
  }),
);

export type NotificationQuietHoursRow = typeof notificationQuietHours.$inferSelect;

/**
 * Templates. System defaults live with tenant_id = NULL. Tenant overrides
 * are full rows. The resolver picks tenant row over system row.
 *
 * Each (template_key, channel) is unique within its tenant scope. Variables
 * declared in `variables_schema` are advisory — the dispatcher renders with
 * whatever the payload contains, but the admin UI uses this to drive the
 * preview form.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey(),
    /** Null = system default. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),

    templateKey: text('template_key').notNull(),
    channel: text('channel', { enum: notificationChannelValues }).notNull(),

    /** Email subject / push title. */
    subject: text('subject'),
    /** Body — Handlebars template. HTML for email, plain text for SMS, JSON for push (with data block). */
    body: text('body').notNull(),
    /** Plain-text alternative for email (auto-derived if null). */
    bodyPlain: text('body_plain'),

    /** Schema definition for variable preview. jsonb<{ key: string; example: unknown }[]>. */
    variablesSchema: jsonb('variables_schema').notNull().$type<unknown[]>().default([] as unknown[]),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique landing in 0016 SQL.
    tenantKeyChannelIdx: index('notification_templates_lookup_idx').on(
      t.tenantId,
      t.templateKey,
      t.channel,
    ),
  }),
);

export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect;

/**
 * Outbound webhook subscriptions. Used for the public API (Phase 2) and for
 * any internal consumer that wants HMAC-signed event delivery.
 */
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    endpointUrl: text('endpoint_url').notNull(),
    /** AES-256 encrypted shared HMAC secret. Stored ciphertext; rotated via admin UI. */
    secret: text('secret').notNull(),
    /** Array of event_type strings. ['*'] subscribes to everything. */
    eventTypes: jsonb('event_types').notNull().$type<string[]>().default([] as string[]),

    active: boolean('active').notNull().default(true),

    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastFailureReason: text('last_failure_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantActiveIdx: index('webhook_subscriptions_tenant_active_idx').on(t.tenantId, t.active),
  }),
);

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;

/**
 * Dead-letter queue for notifications whose every channel attempt was
 * exhausted. Retention 30 days, sweep cron lives in NotificationsService.
 */
export const notificationDeadLetters = pgTable(
  'notification_dead_letters',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    deliveryId: uuid('delivery_id').references(() => notificationDeliveries.id, {
      onDelete: 'set null',
    }),
    channel: text('channel', { enum: notificationChannelValues }).notNull(),

    /** Frozen snapshot of the payload at the point of failure. */
    payloadSnapshot: jsonb('payload_snapshot').notNull(),
    failureReason: text('failure_reason').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),

    /** When the admin clicks retry, we move the row + bump the retry counter. */
    retriedAt: timestamp('retried_at', { withTimezone: true }),
    retriedByUserId: uuid('retried_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('notification_dead_letters_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    tenantChannelIdx: index('notification_dead_letters_tenant_channel_idx').on(
      t.tenantId,
      t.channel,
    ),
  }),
);

export type NotificationDeadLetterRow = typeof notificationDeadLetters.$inferSelect;

/**
 * Device tokens for FCM/APNs. Tenant-scoped so a token registered under one
 * tenant cannot receive notifications targeted to another (kill-switch).
 */
export const notificationDeviceTokens = pgTable(
  'notification_device_tokens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    platform: text('platform').notNull(), // 'android' | 'ios' | 'web'
    /** FCM registration token (Android+iOS via Firebase) or APNs device token. */
    token: text('token').notNull(),
    /** Device identifier from the client. Used to upsert on token rotation. */
    deviceId: text('device_id').notNull(),
    appVersion: text('app_version'),

    /** Soft-disable a token after FCM reports NotRegistered or similar. */
    active: boolean('active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantUserIdx: index('notification_device_tokens_tenant_user_idx').on(t.tenantId, t.userId),
    tenantTokenUniq: uniqueIndex('notification_device_tokens_tenant_token_unique').on(
      t.tenantId,
      t.token,
    ),
    tenantUserDeviceUniq: uniqueIndex('notification_device_tokens_tenant_user_device_unique').on(
      t.tenantId,
      t.userId,
      t.deviceId,
    ),
  }),
);

export type NotificationDeviceTokenRow = typeof notificationDeviceTokens.$inferSelect;

/**
 * Webhook delivery log — every outbound webhook attempt. Surfaced in
 * /admin/webhooks page so the admin can see what fired, retry failures.
 * Lighter than notification_deliveries because webhooks don't need the
 * read-state / rendered-body columns.
 */
export const notificationWebhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),

    eventType: text('event_type').notNull(),
    requestBody: jsonb('request_body').notNull(),
    signature: text('signature').notNull(),

    status: text('status', { enum: notificationDeliveryStatusValues }).notNull().default('queued'),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Backoff target — claim worker skips rows whose retry_at is in the future. */
    retryAt: timestamp('retry_at', { withTimezone: true }),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('webhook_deliveries_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    subscriptionIdx: index('webhook_deliveries_subscription_idx').on(t.subscriptionId, t.createdAt),
  }),
);

export type NotificationWebhookDeliveryRow = typeof notificationWebhookDeliveries.$inferSelect;
