/**
 * storage_billing_runs — one summary row per auto-billing cron sweep
 * (Yard Management, Session 54). Immutable run log; no soft delete.
 * Defined in packages/db/sql/0051_yard_management.sql.
 */
import { bigint, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { yardFacilities } from './yard-facilities';

export const storageBillingRunStatusValues = ['pending', 'completed', 'failed'] as const;
export type StorageBillingRunStatus = (typeof storageBillingRunStatusValues)[number];

export const storageBillingRuns = pgTable(
  'storage_billing_runs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id').references(() => yardFacilities.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    vehiclesCharged: integer('vehicles_charged').notNull().default(0),
    totalChargedCents: bigint('total_charged_cents', { mode: 'number' }).notNull().default(0),
    status: text('status', { enum: storageBillingRunStatusValues }).notNull().default('pending'),
    errorText: text('error_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantRanIdx: index('storage_billing_runs_tenant_ran_idx').on(t.tenantId, t.ranAt),
  }),
);

export type StorageBillingRun = typeof storageBillingRuns.$inferSelect;
export type NewStorageBillingRun = typeof storageBillingRuns.$inferInsert;
