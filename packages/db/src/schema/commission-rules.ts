/**
 * commission_rules — Session 14.
 *
 * Per-tenant payout rules. Two flavors:
 *   - 'percent' — pay `rate_pct` % of the job's quoted revenue, floor/cap optional.
 *   - 'flat'    — pay `flat_cents` per completed job, irrespective of revenue.
 *
 * Drivers reference a rule via drivers.commission_rule_id (FK back-filled in
 * sql/0037_reporting.sql). The Commission report computes payouts by
 * applying the rule to every completed, non-GOA job assigned to the driver
 * inside the report window.
 *
 * The drivers schema declared this column without an FK constraint in
 * Session 8 because the table didn't exist yet. 0016 creates the table and
 * back-fills the constraint, so by the time anyone runs the migrations end
 * to end, drivers.commission_rule_id is a real foreign key.
 */
import {
  bigint,
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const commissionRuleTypeValues = ['percent', 'flat'] as const;
export type CommissionRuleType = (typeof commissionRuleTypeValues)[number];

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),

    ruleType: text('rule_type', { enum: commissionRuleTypeValues }).notNull().default('percent'),
    /** Used when ruleType='percent'. 0..100 (NUMERIC string). */
    ratePct: numeric('rate_pct', { precision: 6, scale: 4 }).notNull().default('0'),
    /** Used when ruleType='flat'. */
    flatCents: bigint('flat_cents', { mode: 'number' }).notNull().default(0),
    /** Optional cap so a percent rule can't pay out more than this per job. */
    capCents: bigint('cap_cents', { mode: 'number' }),
    /** Optional minimum guaranteed per-job payout. */
    floorCents: bigint('floor_cents', { mode: 'number' }).notNull().default(0),

    active: boolean('active').notNull().default(true),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantNameUnique: uniqueIndex('commission_rules_tenant_name_unique').on(t.tenantId, t.name),
    tenantActiveIdx: index('commission_rules_tenant_active_idx').on(t.tenantId, t.active),
  }),
);

export type CommissionRule = typeof commissionRules.$inferSelect;
export type NewCommissionRule = typeof commissionRules.$inferInsert;
