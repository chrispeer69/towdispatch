/**
 * lien_timeline_events — append-only audit trail of everything that happened
 * to a lien case (Lien Processing, Session 23).
 *
 * payload carries event-specific detail (the step transition, the notice id,
 * the computed due date). actor_user_id is NULL for cron-generated events.
 * Soft-delete columns are present for invariant parity though the table is
 * written append-only in practice.
 *
 * Defined in packages/db/sql/0038_lien_processing.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { lienCases } from './lien-cases';
import { tenants } from './tenants';
import { users } from './users';

export const lienTimelineEventTypeValues = [
  'case_opened',
  'value_tier_set',
  'dmv_lookup_recorded',
  'notice_recorded',
  'response_recorded',
  'step_advanced',
  'action_due',
  'marked_ready_for_sale',
  'case_sold',
  'case_closed',
  'case_canceled',
] as const;
export type LienTimelineEventType = (typeof lienTimelineEventTypeValues)[number];

export const lienTimelineEvents = pgTable(
  'lien_timeline_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    lienCaseId: uuid('lien_case_id')
      .notNull()
      .references(() => lienCases.id, { onDelete: 'cascade' }),
    eventType: text('event_type', { enum: lienTimelineEventTypeValues }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('lien_timeline_events_tenant_case_idx')
      .on(t.tenantId, t.lienCaseId)
      .where(sql`deleted_at IS NULL`),
    caseOccurredIdx: index('lien_timeline_events_case_occurred_idx')
      .on(t.lienCaseId, t.occurredAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type LienTimelineEvent = typeof lienTimelineEvents.$inferSelect;
export type NewLienTimelineEvent = typeof lienTimelineEvents.$inferInsert;
