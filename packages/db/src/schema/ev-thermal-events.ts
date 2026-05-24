/**
 * ev_thermal_events — battery thermal events observed on a job (EV Recovery,
 * Session 48).
 *
 * severity drives the escalation matrix in the pure engine
 * (thermalEventEscalation). The boolean flags record what the tech actually
 * did; photo_keys references storage objects. job_id FK ON DELETE CASCADE.
 * Append-only in practice; soft-delete columns present for invariant parity.
 *
 * Defined in packages/db/sql/0042_ev_recovery.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

// Ordered loosely from earliest warning sign to active fire. The escalation
// engine maps each to a fixed response; see thermalEventEscalation.
export const evThermalSeverityValues = [
  'odor',
  'swelling',
  'smoke',
  'venting',
  'sparking',
  'flames',
] as const;
export type EvThermalSeverity = (typeof evThermalSeverityValues)[number];

export const evThermalEvents = pgTable(
  'ev_thermal_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    severity: text('severity', { enum: evThermalSeverityValues }).notNull(),
    actionTaken: text('action_taken'),
    hazmatCalled: boolean('hazmat_called').notNull().default(false),
    fireDeptCalled: boolean('fire_dept_called').notNull().default(false),
    customerEvacuated: boolean('customer_evacuated').notNull().default(false),
    sceneSecured: boolean('scene_secured').notNull().default(false),
    photoKeys: text('photo_keys').array().notNull().default(sql`'{}'`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJobIdx: index('ev_thermal_events_tenant_job_idx')
      .on(t.tenantId, t.jobId)
      .where(sql`deleted_at IS NULL`),
    observedIdx: index('ev_thermal_events_observed_idx')
      .on(t.observedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type EvThermalEventRow = typeof evThermalEvents.$inferSelect;
export type NewEvThermalEventRow = typeof evThermalEvents.$inferInsert;
