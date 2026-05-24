/**
 * repo_cases — one repossession assignment: a vehicle to recover for a
 * lienholder (Repo Workflow Session 49).
 *
 * The debtor and vehicle are snapshotted on the row (the debtor is never a
 * tenant customer). Status machine (enforced in RepoCaseService):
 *   open -> located -> recovered -> closed
 *   open -> surrendered -> closed
 *   open|located -> cancelled
 * redemption_ends_at is derived from recovered_at + redemption_window_days at
 * recovery time. Defined in packages/db/sql/0051_repo_workflow.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { lienholders } from './lienholders';
import { tenants } from './tenants';
import { users } from './users';

export const repoCaseStatusValues = [
  'open',
  'located',
  'recovered',
  'surrendered',
  'closed',
  'cancelled',
] as const;
export type RepoCaseStatus = (typeof repoCaseStatusValues)[number];

export const repoCases = pgTable(
  'repo_cases',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    lienholderId: uuid('lienholder_id')
      .notNull()
      .references(() => lienholders.id, { onDelete: 'restrict' }),
    caseNumber: text('case_number').notNull(),
    vin: text('vin'),
    vehicleYear: integer('vehicle_year'),
    vehicleMake: text('vehicle_make'),
    vehicleModel: text('vehicle_model'),
    vehicleColor: text('vehicle_color'),
    plate: text('plate'),
    debtorName: text('debtor_name'),
    debtorAddress: text('debtor_address'),
    debtorPhone: text('debtor_phone'),
    debtorSecondaryAddress: jsonb('debtor_secondary_address'),
    status: text('status', { enum: repoCaseStatusValues }).notNull().default('open'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    locatedAt: timestamp('located_at', { withTimezone: true }),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    redemptionWindowDays: integer('redemption_window_days'),
    redemptionEndsAt: timestamp('redemption_ends_at', { withTimezone: true }),
    refAssignmentId: text('ref_assignment_id'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('repo_cases_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    tenantLienholderIdx: index('repo_cases_tenant_lienholder_idx')
      .on(t.tenantId, t.lienholderId)
      .where(sql`deleted_at IS NULL`),
    tenantAssignedIdx: index('repo_cases_tenant_assigned_idx')
      .on(t.tenantId, t.assignedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RepoCase = typeof repoCases.$inferSelect;
export type NewRepoCase = typeof repoCases.$inferInsert;
