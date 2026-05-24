/**
 * repo_timeline_events — append-only audit trail of compliance activity for a
 * repossession case (Repo Compliance, Session 50).
 *
 * payload carries event-specific detail (the notice id, the computed
 * redemption / hold date, the breach reasons). actor_user_id is NULL for
 * cron-generated events. Soft-delete columns are present for invariant parity
 * though the table is written append-only in practice.
 *
 * S49 DEFERRAL: `repo_case_id` is `uuid NOT NULL` with NO foreign key — see
 * repo-required-notices.ts and SESSION_50_DECISIONS.md (D0).
 *
 * Defined in packages/db/sql/0051_repo_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const repoTimelineEventTypeValues = [
  'notice_recorded',
  'notice_response_recorded',
  'notice_overdue',
  'breach_of_peace_flagged',
  'redemption_computed',
  'personal_property_hold_computed',
] as const;
export type RepoTimelineEventType = (typeof repoTimelineEventTypeValues)[number];

export const repoTimelineEvents = pgTable(
  'repo_timeline_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    // No FK to repo_cases — that table is S49's (not on master).
    repoCaseId: uuid('repo_case_id').notNull(),
    eventType: text('event_type', { enum: repoTimelineEventTypeValues }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('repo_timeline_events_tenant_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`deleted_at IS NULL`),
    caseOccurredIdx: index('repo_timeline_events_case_occurred_idx')
      .on(t.repoCaseId, t.occurredAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RepoTimelineEvent = typeof repoTimelineEvents.$inferSelect;
export type NewRepoTimelineEvent = typeof repoTimelineEvents.$inferInsert;
