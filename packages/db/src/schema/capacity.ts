/**
 * Capacity-Aware Dispatch Signaling (CADS) — five tables.
 *
 * CADS continuously computes the tenant's live dispatch load per duty
 * class and broadcasts machine-readable availability to motor-club
 * partners:
 *
 *   load_ratio = weighted_active_jobs / eligible_signed_in_drivers
 *
 *   - capacity_settings   — per-tenant thresholds/weights/hysteresis knobs.
 *   - capacity_snapshots  — time-series of computed state per duty class.
 *   - capacity_overrides  — manual band forces (storm mode), auto-expiring.
 *   - capacity_partners   — registered outbound partners + credentials.
 *   - capacity_broadcasts — delivery receipts for every outbound attempt.
 *
 * Duty classes are light|medium|heavy ('all' additionally appears on
 * snapshots/overrides for the blended row / global override). Bands map
 * ratio → availability; OFFLINE is the zero-eligible-drivers state, never
 * a divide-by-zero.
 *
 * Credential storage: api_key_hash is one-way (pbkdf2, matches
 * public-api api-key.util); webhook_secret_encrypted is AES-256-GCM via
 * WebhookSecretCipher because outbound payload signing needs the
 * plaintext back.
 *
 * RLS, audit triggers, CHECK constraints and partial unique indexes live
 * in packages/db/sql/0052_capacity_signaling.sql.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { yardFacilities } from './yard-facilities';

export const capacityDutyClassValues = ['light', 'medium', 'heavy'] as const;
export type CapacityDutyClass = (typeof capacityDutyClassValues)[number];

/** Snapshot/override scope: a concrete class or the blended/global 'all'. */
export const capacityClassScopeValues = ['light', 'medium', 'heavy', 'all'] as const;
export type CapacityClassScope = (typeof capacityClassScopeValues)[number];

export const capacityBandValues = [
  'available_now',
  'limited',
  'constrained',
  'at_capacity',
  'offline',
] as const;
export type CapacityBand = (typeof capacityBandValues)[number];

export const capacityDeliveryModeValues = ['webhook', 'pull_only'] as const;
export type CapacityDeliveryMode = (typeof capacityDeliveryModeValues)[number];

/** 'delivering' = leased by the worker while the POST is in flight. */
export const capacityBroadcastStatusValues = [
  'pending',
  'delivering',
  'delivered',
  'failed',
  'dead_letter',
] as const;
export type CapacityBroadcastStatus = (typeof capacityBroadcastStatusValues)[number];

export const capacitySettings = pgTable(
  'capacity_settings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Band upper bounds: ratio <= available_max → AVAILABLE_NOW, etc. */
    availableMaxRatio: numeric('available_max_ratio').notNull().default('0.75'),
    limitedMaxRatio: numeric('limited_max_ratio').notNull().default('1.50'),
    constrainedMaxRatio: numeric('constrained_max_ratio').notNull().default('2.00'),

    /** job status → weight; statuses absent from the map count 0. */
    jobWeights: jsonb('job_weights')
      .notNull()
      .default({ dispatched: 1.0, enroute: 1.0, on_scene: 1.0, in_progress: 1.0 }),

    /** Band changes need |ratio - boundary| > buffer OR dwell seconds across it. */
    hysteresisBuffer: numeric('hysteresis_buffer').notNull().default('0.05'),
    hysteresisDwellSeconds: integer('hysteresis_dwell_seconds').notNull().default(60),
    /** Floor between outbound broadcasts per partner, regardless of transitions. */
    minBroadcastIntervalSeconds: integer('min_broadcast_interval_seconds').notNull().default(60),
    /** Contractual max-response guideline communicated to partners. */
    guidelineMinutes: integer('guideline_minutes').notNull().default(60),

    /** Override auto-expiry default (minutes); hard max 24h via SQL CHECK. */
    overrideDefaultExpiryMinutes: integer('override_default_expiry_minutes').notNull().default(240),

    /** v1 stub: per-yard computation gate. No zone UI in v1. */
    perYardEnabled: boolean('per_yard_enabled').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantUnique: uniqueIndex('capacity_settings_tenant_unique').on(t.tenantId),
  }),
);

export type CapacitySettingsRow = typeof capacitySettings.$inferSelect;
export type NewCapacitySettingsRow = typeof capacitySettings.$inferInsert;

export const capacitySnapshots = pgTable(
  'capacity_snapshots',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    dutyClass: text('duty_class', { enum: capacityClassScopeValues }).notNull(),
    band: text('band', { enum: capacityBandValues }).notNull(),
    /** NULL when the class is OFFLINE (no eligible drivers). */
    ratio: numeric('ratio'),
    eligibleDrivers: integer('eligible_drivers').notNull().default(0),
    weightedActiveJobs: numeric('weighted_active_jobs').notNull().default('0'),
    overrideActive: boolean('override_active').notNull().default(false),
    /** v1 zone hook: NULL = company-wide row. */
    yardId: uuid('yard_id').references(() => yardFacilities.id, { onDelete: 'set null' }),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantClassComputedIdx: index('capacity_snapshots_tenant_class_computed_idx').on(
      t.tenantId,
      t.dutyClass,
      t.computedAt,
    ),
  }),
);

export type CapacitySnapshot = typeof capacitySnapshots.$inferSelect;
export type NewCapacitySnapshot = typeof capacitySnapshots.$inferInsert;

export const capacityOverrides = pgTable(
  'capacity_overrides',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** 'all' forces every class; a concrete class forces just that one. */
    dutyClass: text('duty_class', { enum: capacityClassScopeValues }).notNull().default('all'),
    forcedBand: text('forced_band', { enum: capacityBandValues }).notNull(),
    reason: text('reason').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    clearedBy: uuid('cleared_by').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => ({
    tenantExpiresIdx: index('capacity_overrides_tenant_expires_idx').on(t.tenantId, t.expiresAt),
  }),
);

export type CapacityOverride = typeof capacityOverrides.$inferSelect;
export type NewCapacityOverride = typeof capacityOverrides.$inferInsert;

export const capacityPartners = pgTable(
  'capacity_partners',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    /** Follows accounts.motor_club_network_code ('agero', 'nsd', ..., 'generic'). */
    networkCode: text('network_code').notNull().default('generic'),
    deliveryMode: text('delivery_mode', { enum: capacityDeliveryModeValues })
      .notNull()
      .default('webhook'),

    webhookUrl: text('webhook_url'),
    /** AES-256-GCM via WebhookSecretCipher; plaintext shown once. */
    webhookSecretEncrypted: text('webhook_secret_encrypted'),

    /** Pull-API credential: prefix locates the row, hash verifies (pbkdf2). */
    apiKeyPrefix: text('api_key_prefix'),
    apiKeyHash: text('api_key_hash'),

    enabled: boolean('enabled').notNull().default(true),

    /** Duty classes this partner receives; subset of light|medium|heavy. */
    classVisibility: text('class_visibility')
      .array()
      .notNull()
      .default(['light', 'medium', 'heavy']),

    lastBroadcastAt: timestamp('last_broadcast_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantNameUnique: uniqueIndex('capacity_partners_tenant_name_unique').on(t.tenantId, t.name),
    apiKeyPrefixUnique: uniqueIndex('capacity_partners_api_key_prefix_unique').on(t.apiKeyPrefix),
  }),
);

export type CapacityPartner = typeof capacityPartners.$inferSelect;
export type NewCapacityPartner = typeof capacityPartners.$inferInsert;

export const capacityBroadcasts = pgTable(
  'capacity_broadcasts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => capacityPartners.id, { onDelete: 'restrict' }),

    payload: jsonb('payload').notNull(),
    status: text('status', { enum: capacityBroadcastStatusValues }).notNull().default('pending'),

    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    retryCount: integer('retry_count').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCreatedIdx: index('capacity_broadcasts_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantPartnerIdx: index('capacity_broadcasts_tenant_partner_idx').on(
      t.tenantId,
      t.partnerId,
      t.createdAt,
    ),
    // Partial (WHERE status IN ('pending','delivering') AND deleted_at IS
    // NULL) in SQL 0052; Drizzle mirrors the keyed column for the sweep.
    pendingRetryIdx: index('capacity_broadcasts_pending_retry_idx').on(t.nextRetryAt),
  }),
);

export type CapacityBroadcast = typeof capacityBroadcasts.$inferSelect;
export type NewCapacityBroadcast = typeof capacityBroadcasts.$inferInsert;
