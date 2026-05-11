/**
 * sync_jobs — Session 12.
 *
 * The accounting sync queue. Each row represents one pending or completed
 * synchronization of a single domain entity to/from a single external
 * provider. The engine relies on a partial unique index
 *   (tenant_id, provider, entity_type, entity_id, direction)
 *   WHERE status IN ('pending','processing')
 * to make enqueue() idempotent — if a job is already in flight, re-enqueue
 * is a no-op (ON CONFLICT DO NOTHING). Once a row terminates the next
 * enqueue is allowed to insert.
 *
 * Retry policy:
 *   retry_count starts at 0 and increments on every failed attempt. After
 *   5 attempts the row is moved to status='dead_letter' and surfaced via
 *   the API for operator triage.
 */
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accountingProviderValues } from './accounting-connections';
import { tenants } from './tenants';

export const syncJobEntityTypeValues = ['customer', 'invoice', 'payment', 'refund'] as const;
export type SyncJobEntityType = (typeof syncJobEntityTypeValues)[number];

export const syncJobDirectionValues = ['push', 'pull'] as const;
export type SyncJobDirection = (typeof syncJobDirectionValues)[number];

export const syncJobStatusValues = [
  'pending',
  'processing',
  'completed',
  'failed',
  'dead_letter',
] as const;
export type SyncJobStatus = (typeof syncJobStatusValues)[number];

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    provider: text('provider', { enum: accountingProviderValues }).notNull(),
    entityType: text('entity_type', { enum: syncJobEntityTypeValues }).notNull(),
    entityId: uuid('entity_id').notNull(),
    direction: text('direction', { enum: syncJobDirectionValues }).notNull(),
    status: text('status', { enum: syncJobStatusValues }).notNull().default('pending'),

    /** Set after a successful push so future enqueues can update vs create. */
    externalId: text('external_id'),

    retryCount: integer('retry_count').notNull().default(0),

    /** Earliest moment the engine may try to process this row. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),

    /** Optional sidecar (e.g. the webhook payload that triggered a pull). */
    payload: jsonb('payload'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusNextIdx: index('sync_jobs_tenant_status_next_idx').on(
      t.tenantId,
      t.status,
      t.nextAttemptAt,
    ),
    statusNextIdx: index('sync_jobs_status_next_idx').on(t.status, t.nextAttemptAt),
    tenantEntityIdx: index('sync_jobs_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  }),
);

export type SyncJob = typeof syncJobs.$inferSelect;
export type NewSyncJob = typeof syncJobs.$inferInsert;
