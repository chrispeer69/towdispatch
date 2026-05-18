/**
 * driver_daily_briefings — admin-authored daily message shown to every
 * driver before their first job of the shift.
 *
 * is_active is enforced unique-per-tenant for live rows by a partial
 * unique index — only one briefing is "the briefing of the day" at a
 * time; switching is the admin's explicit action.
 *
 * video_min_duration_seconds is the threshold the truck-app uses to gate
 * the acknowledgment button: the driver must watch at least this many
 * seconds before they can ack. Default 60s.
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const driverDailyBriefings = pgTable(
  'driver_daily_briefings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    message: text('message').notNull(),
    videoUrl: text('video_url'),
    videoMinDurationSeconds: integer('video_min_duration_seconds').notNull().default(60),
    isActive: boolean('is_active').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantActiveUnique: uniqueIndex('driver_daily_briefings_tenant_active_unique')
      .on(t.tenantId)
      .where(sql`is_active = true AND deleted_at IS NULL`),
    tenantCreatedIdx: index('driver_daily_briefings_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type DriverDailyBriefing = typeof driverDailyBriefings.$inferSelect;
export type NewDriverDailyBriefing = typeof driverDailyBriefings.$inferInsert;
