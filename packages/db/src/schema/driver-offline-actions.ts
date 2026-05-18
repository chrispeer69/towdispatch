/**
 * driver_offline_actions — server-side ledger of actions the driver app
 * queued while offline and replayed on reconnect.
 *
 * client_event_uuid is the idempotency key: same UUID across retries
 * means the same logical action. Unique on (tenant_id, driver_id,
 * client_event_uuid) so the replay handler can do a single-row lookup
 * to decide "already applied? skip."
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { driverShifts } from './driver-shifts';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';

export const driverOfflineActionStatusValues = ['pending', 'applied', 'failed', 'skipped'] as const;
export type DriverOfflineActionStatus = (typeof driverOfflineActionStatusValues)[number];

export const driverOfflineActions = pgTable(
  'driver_offline_actions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id').references(() => driverShifts.id, { onDelete: 'set null' }),
    actionKind: text('action_kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    clientTimestamp: timestamp('client_timestamp', { withTimezone: true }).notNull(),
    clientEventUuid: uuid('client_event_uuid').notNull(),
    status: text('status', { enum: driverOfflineActionStatusValues }).notNull().default('pending'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    attemptCount: integer('attempt_count').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantDriverClientEventUnique: uniqueIndex('doa_tenant_driver_client_event_unique').on(
      t.tenantId,
      t.driverId,
      t.clientEventUuid,
    ),
    tenantDriverReceivedIdx: index('doa_tenant_driver_received_idx').on(
      t.tenantId,
      t.driverId,
      t.receivedAt,
    ),
    tenantStatusReceivedIdx: index('doa_tenant_status_received_idx').on(
      t.tenantId,
      t.status,
      t.receivedAt,
    ),
    tenantJobIdx: index('doa_tenant_job_idx').on(t.tenantId, t.jobId),
  }),
);

export type DriverOfflineAction = typeof driverOfflineActions.$inferSelect;
export type NewDriverOfflineAction = typeof driverOfflineActions.$inferInsert;
