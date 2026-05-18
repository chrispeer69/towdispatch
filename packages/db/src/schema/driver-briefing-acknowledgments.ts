/**
 * driver_briefing_acknowledgments — append-only ledger of who saw which
 * daily briefing on which calendar date.
 *
 * (tenant_id, driver_id, briefing_id, acknowledged_date) is unique so
 * the daily ack is at most one per (driver, briefing, day). No soft
 * delete — corrections are a new row with a different date.
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { driverDailyBriefings } from './driver-daily-briefings';
import { drivers } from './drivers';
import { tenants } from './tenants';

export const driverBriefingAcknowledgments = pgTable(
  'driver_briefing_acknowledgments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    briefingId: uuid('briefing_id')
      .notNull()
      .references(() => driverDailyBriefings.id, { onDelete: 'restrict' }),
    acknowledgedDate: date('acknowledged_date').notNull(),
    messageReadAt: timestamp('message_read_at', { withTimezone: true }),
    videoCompletedAt: timestamp('video_completed_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    driverBriefingDateUnique: uniqueIndex('dba_tenant_driver_briefing_date_unique').on(
      t.tenantId,
      t.driverId,
      t.briefingId,
      t.acknowledgedDate,
    ),
    tenantBriefingIdx: index('dba_tenant_briefing_idx').on(
      t.tenantId,
      t.briefingId,
      t.acknowledgedDate,
    ),
    tenantDriverIdx: index('dba_tenant_driver_idx').on(t.tenantId, t.driverId, t.acknowledgedDate),
  }),
);

export type DriverBriefingAcknowledgment = typeof driverBriefingAcknowledgments.$inferSelect;
export type NewDriverBriefingAcknowledgment = typeof driverBriefingAcknowledgments.$inferInsert;
