/**
 * ev_charge_station_visits — charge stops during a long-haul EV recovery
 * (EV Recovery, Session 48).
 *
 * A drained EV may need charge to reach its destination or to enable
 * Transport Mode. Tracks the network, dwell window, energy delivered, cost,
 * and who pays (tenant / customer / club, for reimbursement reporting).
 * job_id FK ON DELETE CASCADE.
 *
 * kwh_delivered is numeric — drizzle returns it as a string; the service maps
 * it to a number at the DTO boundary. cost_cents is integer cents.
 *
 * Defined in packages/db/sql/0042_ev_recovery.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const evChargePaidByValues = ['tenant', 'customer', 'club'] as const;
export type EvChargePaidBy = (typeof evChargePaidByValues)[number];

export const evChargeStationVisits = pgTable(
  'ev_charge_station_visits',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    stationNetwork: text('station_network'),
    stationAddress: text('station_address'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }).notNull().defaultNow(),
    departedAt: timestamp('departed_at', { withTimezone: true }),
    kwhDelivered: numeric('kwh_delivered', { precision: 7, scale: 2 }),
    costCents: bigint('cost_cents', { mode: 'number' }),
    paidBy: text('paid_by', { enum: evChargePaidByValues }).notNull().default('tenant'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJobIdx: index('ev_charge_station_visits_tenant_job_idx')
      .on(t.tenantId, t.jobId)
      .where(sql`deleted_at IS NULL`),
    arrivedIdx: index('ev_charge_station_visits_arrived_idx')
      .on(t.arrivedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type EvChargeStationVisitRow = typeof evChargeStationVisits.$inferSelect;
export type NewEvChargeStationVisitRow = typeof evChargeStationVisits.$inferInsert;
