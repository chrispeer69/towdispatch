/**
 * tenant_activation_events — append-only ledger of activation milestones.
 *
 * Each row marks a milestone reached for the first time on a tenant's
 * journey from signup to "first job dispatched" and beyond. The partial
 * unique index on (tenant_id, event_type) makes emission idempotent: the
 * service attempts an insert whenever it observes a milestone and relies on
 * ON CONFLICT DO NOTHING to keep exactly one row.
 *
 * No soft delete — a milestone, once reached, is permanent. Audited,
 * FORCE RLS. Defined in packages/db/sql/0036_onboarding.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const activationEventTypeValues = [
  'account_created',
  'email_verified',
  'company_info_completed',
  'first_user_invited',
  'first_truck_added',
  'first_driver_added',
  'first_job_dispatched',
  'free_tier_activated',
  'onboarding_completed',
] as const;
export type ActivationEventType = (typeof activationEventTypeValues)[number];

export const tenantActivationEvents = pgTable(
  'tenant_activation_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    eventType: text('event_type', { enum: activationEventTypeValues }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantTypeUnique: uniqueIndex('tenant_activation_events_tenant_type_unique').on(
      t.tenantId,
      t.eventType,
    ),
    tenantOccurredIdx: index('tenant_activation_events_tenant_occurred_idx').on(
      t.tenantId,
      t.occurredAt,
    ),
  }),
);

export type TenantActivationEvent = typeof tenantActivationEvents.$inferSelect;
export type NewTenantActivationEvent = typeof tenantActivationEvents.$inferInsert;
