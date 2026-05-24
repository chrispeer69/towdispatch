/**
 * lien_cases — one row per statutory lien proceeding against an impounded
 * vehicle (Lien Processing, Session 23).
 *
 * impound_record_id links the stored vehicle (ON DELETE RESTRICT — a lien
 * case must outlive deletion attempts on its record). current_step is the
 * workflow position; next_action_due_at is the rule engine's computed
 * deadline for the next operator action (the nightly cron recomputes it).
 * One live case per impound record (partial unique index in the migration).
 *
 * Defined in packages/db/sql/0038_lien_processing.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { users } from './users';

export const lienCaseStatusValues = [
  'open',
  'ready_for_sale',
  'sold',
  'closed',
  'canceled',
] as const;
export type LienCaseStatus = (typeof lienCaseStatusValues)[number];

export const lienCaseStepValues = [
  'opened',
  'dmv_lookup_requested',
  'dmv_lookup_complete',
  'owner_notice_sent',
  'lienholder_notice_sent',
  'publication_complete',
  'waiting_period',
  'ready_for_sale',
  'sold',
  'closed',
] as const;
export type LienCaseStep = (typeof lienCaseStepValues)[number];

export const lienValueTierValues = ['low', 'mid', 'high'] as const;
export type LienValueTier = (typeof lienValueTierValues)[number];

export const lienCases = pgTable(
  'lien_cases',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundRecordId: uuid('impound_record_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'restrict' }),
    state: text('state').notNull(),
    status: text('status', { enum: lienCaseStatusValues }).notNull().default('open'),
    currentStep: text('current_step', { enum: lienCaseStepValues }).notNull().default('opened'),
    vehicleValueTier: text('vehicle_value_tier', { enum: lienValueTierValues })
      .notNull()
      .default('mid'),
    ownerFound: boolean('owner_found').notNull().default(false),
    lienholderFound: boolean('lienholder_found').notNull().default(false),
    estimatedValueCents: bigint('estimated_value_cents', { mode: 'number' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    nextActionDueAt: timestamp('next_action_due_at', { withTimezone: true }),
    readyForSaleAt: timestamp('ready_for_sale_at', { withTimezone: true }),
    soldAt: timestamp('sold_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('lien_cases_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    tenantStateIdx: index('lien_cases_tenant_state_idx')
      .on(t.tenantId, t.state)
      .where(sql`deleted_at IS NULL`),
    dueActiveIdx: index('lien_cases_due_active_idx')
      .on(t.nextActionDueAt)
      .where(sql`status IN ('open', 'ready_for_sale') AND deleted_at IS NULL`),
  }),
);

export type LienCase = typeof lienCases.$inferSelect;
export type NewLienCase = typeof lienCases.$inferInsert;
