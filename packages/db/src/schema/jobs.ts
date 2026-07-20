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
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  numeric,
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
  'repo',
  'other',
] as const;
export type JobServiceType = (typeof jobServiceTypeValues)[number];

/** CADS duty bucket for a job — mirrors trucks.duty_class values. */
export const jobDutyClassValues = ['light', 'medium', 'heavy'] as const;
export type JobDutyClass = (typeof jobDutyClassValues)[number];

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

    /**
     * CADS duty bucket (light|medium|heavy). Derived from service type +
     * vehicle data at creation; settable by dispatch so a misclassed job
     * can be corrected. Added in 0052.
     */
    dutyClass: text('duty_class', { enum: jobDutyClassValues }).notNull().default('light'),

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

    /**
     * Quote-freeze snapshot (Moat #1 Dynamic Pricing). When a quote moves to
     * the `dispatched` lifecycle state, the rate-engine final price is
     * snapshotted here. Subsequent live tier changes do NOT re-price the
     * accepted quote in either direction. Null until acceptance.
     */
    frozenPriceCents: bigint('frozen_price_cents', { mode: 'number' }),

    /**
     * Road-mile tracking (added 2026-05-17). enroute_miles is the dispatch-
     * yard-to-pickup distance; intow_miles is the pickup-to-dropoff distance.
     * Both computed at job creation via the directions service (Mapbox
     * default, Google fallback per tenant flag) and read by the rate engine
     * to generate per-mile invoice line items. Nullable: jobs created before
     * this migration have null values; jobs without a dispatch yard have a
     * null enroute_miles; non-tow jobs have a null intow_miles.
     */
    enrouteMiles: numeric('enroute_miles', { precision: 8, scale: 2 }),
    intowMiles: numeric('intow_miles', { precision: 8, scale: 2 }),
    /** Yard the truck dispatches from — origin for the enroute leg. */
    dispatchYardId: uuid('dispatch_yard_id'),

    /**
     * Tier Offer Composer linkage (Session 2). Set at job-creation time
     * by TierOfferEnforcementService when the job's account belongs to a
     * motor club that's a recipient on an active offer. Both ids null
     * when no active offer covers the dispatch.
     */
    tierOfferId: uuid('tier_offer_id'),
    tierOfferRecipientId: uuid('tier_offer_recipient_id'),
    /**
     * Materialized enforcement decision so the dispatch board can render
     * the right badge without re-running enforcement on every paint.
     *
     *   'accepted'  — motor club explicitly accepted the offer; existing
     *                 tier-resolution flow auto-applies the elevated tier.
     *   'declined'  — motor club explicitly declined; dispatch board
     *                 flags the job for operator review.
     *   'pending'   — motor club has not responded yet; dispatch board
     *                 flags the job for operator review.
     *   'none'      — no active offer for this account/window combo.
     */
    tierOfferEnforcementStatus: text('tier_offer_enforcement_status', {
      enum: ['accepted', 'declined', 'pending', 'none'] as const,
    })
      .notNull()
      .default('none'),

    /**
     * Repossession Workflow linkage (Session 49). Set when a dispatcher
     * creates a `repo` service_type job from a repo_case; the case row drives
     * the prefill (debtor as customer, lienholder as payer, no signature/SMS).
     * Null for every non-repo job. FK lives in 0051_repo_workflow.sql; left
     * uncoupled here like dispatchYardId / tierOfferId to avoid a core→feature
     * schema import cycle.
     */
    repoCaseId: uuid('repo_case_id'),

    /**
     * Convinicar Integration Linkage. Set when a job is synced from the
     * Convinicar API. Null for natively created jobs.
     */
    convinicarServiceRequestId: uuid('convinicar_service_request_id'),
    convinicarOfferId: uuid('convinicar_offer_id'),

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
    // Partial index used by the dispatch-board flagged-jobs filter
    // (Tier Offer Composer Session 2). The vast majority of jobs sit at
    // 'none' so we avoid index bloat by filtering them out.
    tenantTierOfferEnforcementIdx: index('jobs_tenant_tier_offer_enforcement_idx')
      .on(t.tenantId, t.tierOfferEnforcementStatus)
      .where(sql`tier_offer_enforcement_status <> 'none'`),
    // Repo Workflow (Session 49): the handful of jobs linked to a repo case.
    tenantRepoCaseIdx: index('jobs_tenant_repo_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`repo_case_id IS NOT NULL`),
    // Convinicar Integration index to quickly look up if a sync has already occurred
    tenantConvinicarIdx: index('jobs_tenant_convinicar_idx')
      .on(t.tenantId, t.convinicarServiceRequestId)
      .where(sql`convinicar_service_request_id IS NOT NULL`),
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
