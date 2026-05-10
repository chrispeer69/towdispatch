/**
 * jobs — every dispatched piece of work, the heart of the platform.
 *
 * A job starts life in `new` from the call-intake screen and walks through
 * the dispatch state machine: dispatched → enroute → on_scene → in_progress
 * → completed. Two terminal failure states: `cancelled` (caller / dispatcher
 * pulled the plug) and `goa` (driver arrived but customer/vehicle was Gone
 * On Arrival). State transitions are validated in JobsService — the column
 * itself is just the source of truth.
 *
 * job_number is a tenant-scoped, human-readable, day-bucketed identifier:
 *   YYYYMMDD-NNNN  e.g. 20260509-0001.
 * The sequence is allocated by job_number_sequences (tenant_id, day) with
 * UPDATE ... RETURNING last_seq + 1, so two intakes for the same tenant on
 * the same day cannot collide. Drivers and customers refer to jobs by this
 * number, never by the UUID.
 *
 * customer_id / vehicle_id are nullable while the job is being captured by
 * the intake screen, but in practice both are filled by the time the job
 * leaves `new`. account_id is genuinely nullable — a cash job has no account.
 *
 * dropoff_* are nullable for non-tow services (jump start, lockout, fuel,
 * tire change, recovery in place, etc.).
 *
 * rate_quoted_cents is the headline number the dispatcher quoted at intake.
 * rate_breakdown stores the full RateQuote (line items + trace) so we can
 * reconstruct exactly how that number was calculated even after the rate
 * sheet has been edited.
 */
import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { customers } from './customers';
import { tenants } from './tenants';
import { users } from './users';
import { vehicles } from './vehicles';

export const jobStatusValues = [
  'new',
  'dispatched',
  'enroute',
  'on_scene',
  'in_progress',
  'completed',
  'cancelled',
  'goa',
] as const;
export type JobStatus = (typeof jobStatusValues)[number];

export const jobServiceTypeValues = [
  'tow',
  'jump_start',
  'lockout',
  'tire_change',
  'fuel',
  'winch',
  'recovery',
  'impound',
  'other',
] as const;
export type JobServiceType = (typeof jobServiceTypeValues)[number];

export const jobAuthorizedByValues = [
  'customer',
  'account_contact',
  'motor_club',
  'police',
  'other',
] as const;
export type JobAuthorizedBy = (typeof jobAuthorizedByValues)[number];

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    jobNumber: text('job_number').notNull(),

    status: text('status', { enum: jobStatusValues }).notNull().default('new'),
    serviceType: text('service_type', { enum: jobServiceTypeValues }).notNull(),

    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),

    pickupAddress: text('pickup_address').notNull(),
    pickupLat: text('pickup_lat'),
    pickupLng: text('pickup_lng'),

    dropoffAddress: text('dropoff_address'),
    dropoffLat: text('dropoff_lat'),
    dropoffLng: text('dropoff_lng'),

    authorizedBy: text('authorized_by', { enum: jobAuthorizedByValues }).notNull(),
    authorizedByName: text('authorized_by_name'),

    rateQuotedCents: bigint('rate_quoted_cents', { mode: 'number' }).notNull().default(0),
    rateBreakdown: jsonb('rate_breakdown'),

    notes: text('notes'),

    cancelledReason: text('cancelled_reason'),

    /**
     * Assignment fields populated when the job moves out of `new`. Set as
     * a side effect of the JobsService.assign() transition. Cleared by
     * unassign() (which moves the job back to `new`).
     */
    assignedDriverId: uuid('assigned_driver_id'),
    assignedTruckId: uuid('assigned_truck_id'),
    assignedShiftId: uuid('assigned_shift_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('jobs_tenant_status_idx').on(t.tenantId, t.status),
    tenantCreatedIdx: index('jobs_tenant_created_idx').on(t.tenantId, t.createdAt),
    // (tenant_id, job_number) is unique. Defined as a true unique index so
    // duplicate inserts fault loudly with 23505 instead of leaking through.
    tenantJobNumberUnique: uniqueIndex('jobs_tenant_job_number_unique').on(t.tenantId, t.jobNumber),
    tenantCustomerIdx: index('jobs_tenant_customer_idx').on(t.tenantId, t.customerId),
    tenantVehicleIdx: index('jobs_tenant_vehicle_idx').on(t.tenantId, t.vehicleId),
    tenantAccountIdx: index('jobs_tenant_account_idx').on(t.tenantId, t.accountId),
    tenantDriverIdx: index('jobs_tenant_assigned_driver_idx').on(t.tenantId, t.assignedDriverId),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

/**
 * job_status_transitions — append-only history of every state machine move.
 * The audit_log trigger captures the UPDATE on jobs, but a dedicated
 * transition table is faster to query for "who moved this job from new to
 * dispatched, when?" and lets us attach a free-form reason to each move
 * (cancel/goa reasons, dispatcher notes on reassign).
 */
export const jobStatusTransitions = pgTable(
  'job_status_transitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),

    fromStatus: text('from_status', { enum: jobStatusValues }).notNull(),
    toStatus: text('to_status', { enum: jobStatusValues }).notNull(),

    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantJobIdx: index('job_status_transitions_tenant_job_idx').on(
      t.tenantId,
      t.jobId,
      t.createdAt,
    ),
  }),
);

export type JobStatusTransition = typeof jobStatusTransitions.$inferSelect;
export type NewJobStatusTransition = typeof jobStatusTransitions.$inferInsert;

/**
 * job_number_sequences — one row per (tenant_id, day_key) issuing the next
 * NNNN suffix for that day's job_number. UPSERT + UPDATE ... RETURNING is
 * the allocation primitive. Days never roll back; gaps are acceptable.
 */
export const jobNumberSequences = pgTable(
  'job_number_sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    dayKey: text('day_key').notNull(),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.dayKey] }),
  }),
);

export type JobNumberSequence = typeof jobNumberSequences.$inferSelect;
export type NewJobNumberSequence = typeof jobNumberSequences.$inferInsert;
