/**
 * ev_job_attributes — one row per EV job (EV Recovery, Session 48).
 *
 * job_id links the dispatched job (ON DELETE CASCADE — EV attributes are
 * meaningless without the job). Carries the charge-state intake plus the
 * HV-isolation / tow-mode / OEM-ack flags the tech records on scene. One live
 * row per job (partial unique index in the migration).
 *
 * battery_kwh is numeric — drizzle returns it as a string (house convention,
 * to avoid float drift); the service maps it to a number at the DTO boundary.
 *
 * Defined in packages/db/sql/0042_ev_recovery.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const evBatteryChemistryValues = ['li_ion', 'lfp', 'nicd', 'nimh', 'other'] as const;
export type EvBatteryChemistry = (typeof evBatteryChemistryValues)[number];

export const evJobAttributes = pgTable(
  'ev_job_attributes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    make: text('make'),
    model: text('model'),
    modelYear: integer('model_year'),
    batteryChemistry: text('battery_chemistry', { enum: evBatteryChemistryValues }),
    batteryKwh: numeric('battery_kwh', { precision: 6, scale: 2 }),
    stateOfChargePct: integer('state_of_charge_pct'),
    chargePortLocked: boolean('charge_port_locked').notNull().default(false),
    hvIsolated: boolean('hv_isolated').notNull().default(false),
    towModeEngaged: boolean('tow_mode_engaged').notNull().default(false),
    oemTowProcedureAcknowledged: boolean('oem_tow_procedure_acknowledged').notNull().default(false),
    thermalEventObserved: boolean('thermal_event_observed').notNull().default(false),
    thermalEventNotes: text('thermal_event_notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('ev_job_attributes_tenant_idx').on(t.tenantId).where(sql`deleted_at IS NULL`),
  }),
);

export type EvJobAttributesRow = typeof evJobAttributes.$inferSelect;
export type NewEvJobAttributesRow = typeof evJobAttributes.$inferInsert;
