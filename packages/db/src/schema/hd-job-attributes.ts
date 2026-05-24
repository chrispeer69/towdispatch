/**
 * hd_job_attributes — heavy-duty recovery facts for a job (Heavy-Duty
 * Specialist, Session 36). Added ALONGSIDE jobs (no jobs-table change);
 * one live row per job. requires_* drive the eligibility filters;
 * on_scene_estimate_cents → final_invoice_cents is the HD ticket
 * lifecycle. Defined in packages/db/sql/0040_heavy_duty.sql.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const hdIncidentTypeValues = [
  'overturn',
  'underride',
  'jackknife',
  'load_shift',
  'fire',
  'water',
  'other',
] as const;
export type HdIncidentType = (typeof hdIncidentTypeValues)[number];

export const hdJobAttributes = pgTable(
  'hd_job_attributes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    vehicleClass: integer('vehicle_class'),
    vehicleGvwrLbs: integer('vehicle_gvwr_lbs'),
    vehicleAxleCount: integer('vehicle_axle_count'),
    incidentType: text('incident_type', { enum: hdIncidentTypeValues }),
    cargoType: text('cargo_type'),
    requiresRotator: boolean('requires_rotator').notNull().default(false),
    requiresHazmat: boolean('requires_hazmat').notNull().default(false),
    requiresDotReport: boolean('requires_dot_report').notNull().default(false),
    onSceneEstimateCents: bigint('on_scene_estimate_cents', { mode: 'number' }),
    finalInvoiceCents: bigint('final_invoice_cents', { mode: 'number' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    jobUnique: uniqueIndex('hd_job_attributes_job_unique')
      .on(t.jobId)
      .where(sql`deleted_at IS NULL`),
    tenantIdx: index('hd_job_attributes_tenant_idx').on(t.tenantId).where(sql`deleted_at IS NULL`),
    tenantCreatedIdx: index('hd_job_attributes_tenant_created_idx')
      .on(t.tenantId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type HdJobAttribute = typeof hdJobAttributes.$inferSelect;
export type NewHdJobAttribute = typeof hdJobAttributes.$inferInsert;
