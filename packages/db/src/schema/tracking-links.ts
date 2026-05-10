/**
 * tracking_links — Session 9, customer-facing live tracking.
 *
 * One token per active job. The token is the unguessable URL slug shown in
 * the SMS we send the customer; it unlocks a tightly scoped read-only view
 * of the job (status, ETA, driver first name + truck unit, current map pin).
 *
 * Tokens are single-use-per-job: regenerating rotates to a new value and
 * marks the previous one revoked, so a leaked link can be killed without
 * abandoning tracking. Expiry is enforced server-side; the page never trusts
 * a client clock.
 *
 * SMS lifecycle is captured on the same row to keep dispatcher diagnostics
 * one query away — sms_external_id (Twilio SID), sms_status (queued/sent/
 * delivered/failed), sms_sent_at / sms_delivered_at / sms_failed_reason.
 *
 * The "one active token per job" rule is enforced by a partial unique
 * index in sql/0012_tracking.sql (Drizzle does not express partial uniques
 * fluently in this schema dialect).
 */
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const trackingLinkSmsStatusValues = [
  'pending',
  'queued',
  'sent',
  'delivered',
  'failed',
  'skipped',
] as const;
export type TrackingLinkSmsStatus = (typeof trackingLinkSmsStatusValues)[number];

export const trackingLinks = pgTable(
  'tracking_links',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),

    /** Random base64url, 32 chars (~192 bits entropy). The public URL slug. */
    token: text('token').notNull(),

    /** Once revoked or expired, the public route returns 410 Gone. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** First view captured by the public route. Used for analytics + dispatcher UI. */
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0),
    lastViewedIp: text('last_viewed_ip'),
    lastViewedUserAgent: text('last_viewed_user_agent'),

    /** Twilio (or stub) bookkeeping. */
    smsStatus: text('sms_status', { enum: trackingLinkSmsStatusValues })
      .notNull()
      .default('pending'),
    smsExternalId: text('sms_external_id'),
    smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
    smsDeliveredAt: timestamp('sms_delivered_at', { withTimezone: true }),
    smsFailedReason: text('sms_failed_reason'),
    smsToPhone: text('sms_to_phone'),

    /** When the dispatcher chose at intake to skip the customer SMS. */
    smsSkipped: boolean('sms_skipped').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('tracking_links_token_unique').on(t.token),
    tenantJobIdx: index('tracking_links_tenant_job_idx').on(t.tenantId, t.jobId),
    tenantSmsStatusIdx: index('tracking_links_tenant_sms_status_idx').on(t.tenantId, t.smsStatus),
  }),
);

export type TrackingLink = typeof trackingLinks.$inferSelect;
export type NewTrackingLink = typeof trackingLinks.$inferInsert;

/**
 * tracking_messages — two-way text between customer and dispatcher in the
 * scope of one job.
 *
 *   - 'inbound'  — customer typed it on the public tracking page
 *   - 'outbound' — dispatcher typed it from the dispatch board
 *   - 'system'   — auto-generated (status changes, "driver arrived")
 */
export const trackingMessageDirectionValues = ['inbound', 'outbound', 'system'] as const;
export type TrackingMessageDirection = (typeof trackingMessageDirectionValues)[number];

export const trackingMessages = pgTable(
  'tracking_messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** NULL for system messages, set for customer/dispatcher exchanges. */
    trackingLinkId: uuid('tracking_link_id').references(() => trackingLinks.id, {
      onDelete: 'set null',
    }),

    direction: text('direction', { enum: trackingMessageDirectionValues }).notNull(),
    /** When 'outbound', the user that sent it. Null otherwise. */
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),

    body: text('body').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantJobIdx: index('tracking_messages_tenant_job_idx').on(t.tenantId, t.jobId, t.createdAt),
  }),
);

export type TrackingMessage = typeof trackingMessages.$inferSelect;
export type NewTrackingMessage = typeof trackingMessages.$inferInsert;

/**
 * job_ratings — post-completion feedback collected on the customer tracking
 * page. One per job (enforced by unique index). Stars 1-5, optional free text.
 */
export const jobRatings = pgTable(
  'job_ratings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    trackingLinkId: uuid('tracking_link_id').references(() => trackingLinks.id, {
      onDelete: 'set null',
    }),

    stars: bigint('stars', { mode: 'number' }).notNull(),
    comment: text('comment'),

    submittedFromIp: text('submitted_from_ip'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobUnique: uniqueIndex('job_ratings_tenant_job_unique').on(t.tenantId, t.jobId),
  }),
);

export type JobRating = typeof jobRatings.$inferSelect;
export type NewJobRating = typeof jobRatings.$inferInsert;
