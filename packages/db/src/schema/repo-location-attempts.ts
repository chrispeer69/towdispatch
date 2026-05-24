/**
 * repo_location_attempts — each field attempt to locate / recover the
 * vehicle on a repo case (Repo Workflow Session 49). Append-only: a
 * forwarder bills "per attempt" from it and a court reads it to prove the
 * recovery stayed peaceful. Defined in packages/db/sql/0051_repo_workflow.sql.
 */
import { sql } from 'drizzle-orm';
import { doublePrecision, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repoCases } from './repo-cases';
import { tenants } from './tenants';
import { users } from './users';

export const repoAttemptOutcomeValues = [
  'not_home',
  'wrong_address',
  'spotted_no_attempt',
  'attempted_failed',
  'peaceful_recovery',
  'surrendered',
] as const;
export type RepoAttemptOutcome = (typeof repoAttemptOutcomeValues)[number];

export const repoLocationAttempts = pgTable(
  'repo_location_attempts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    repoCaseId: uuid('repo_case_id')
      .notNull()
      .references(() => repoCases.id, { onDelete: 'cascade' }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    attemptedByUserId: uuid('attempted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    address: text('address'),
    outcome: text('outcome', { enum: repoAttemptOutcomeValues }).notNull(),
    notes: text('notes'),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('repo_location_attempts_tenant_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RepoLocationAttempt = typeof repoLocationAttempts.$inferSelect;
export type NewRepoLocationAttempt = typeof repoLocationAttempts.$inferInsert;
