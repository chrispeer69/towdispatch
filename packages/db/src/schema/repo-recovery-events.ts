/**
 * repo_recovery_events — the recovery itself on a repo case (Repo Workflow
 * Session 49). Normally one per case, but append-only so a botched recovery
 * and a later successful one both stay on the record. Defined in
 * packages/db/sql/0051_repo_workflow.sql.
 */
import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { repoCases } from './repo-cases';
import { tenants } from './tenants';
import { users } from './users';

export const repoRecoveryTypeValues = [
  'peaceful',
  'voluntary_surrender',
  'involuntary_impound',
] as const;
export type RepoRecoveryType = (typeof repoRecoveryTypeValues)[number];

export const repoRecoveryEvents = pgTable(
  'repo_recovery_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    repoCaseId: uuid('repo_case_id')
      .notNull()
      .references(() => repoCases.id, { onDelete: 'cascade' }),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }).notNull().defaultNow(),
    recoveredByUserId: uuid('recovered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    recoveryType: text('recovery_type', { enum: repoRecoveryTypeValues }).notNull(),
    odometer: integer('odometer'),
    conditionNotes: text('condition_notes'),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('repo_recovery_events_tenant_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RepoRecoveryEvent = typeof repoRecoveryEvents.$inferSelect;
export type NewRepoRecoveryEvent = typeof repoRecoveryEvents.$inferInsert;
