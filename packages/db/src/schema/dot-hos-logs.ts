/**
 * dot_hos_logs — hours-of-service duty-status entries (Full DOT Compliance,
 * Session 37). Manual entry — no ELD integration this session. One row per
 * duty-status segment; the HOS validator rolls a driver's entries into a
 * week and flags the property-carrying limits (11h driving, 14h duty
 * window, 30-min break, 60/70-hour rolling). vehicle_id references trucks
 * (the commercial motor vehicle driven). Defined in
 * packages/db/sql/0040_dot_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const dotHosStatusValues = [
  'off_duty',
  'sleeper',
  'driving',
  'on_duty_not_driving',
] as const;
export type DotHosStatus = (typeof dotHosStatusValues)[number];

export const dotHosLogs = pgTable(
  'dot_hos_logs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    logDate: date('log_date').notNull(),
    status: text('status', { enum: dotHosStatusValues }).notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    milesDriven: integer('miles_driven'),
    vehicleId: uuid('vehicle_id').references(() => trucks.id, { onDelete: 'set null' }),
    locationText: text('location_text'),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantDriverDateIdx: index('dot_hos_logs_tenant_driver_date_idx')
      .on(t.tenantId, t.driverId, t.logDate)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DotHosLog = typeof dotHosLogs.$inferSelect;
export type NewDotHosLog = typeof dotHosLogs.$inferInsert;
