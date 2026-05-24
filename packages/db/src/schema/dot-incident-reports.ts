/**
 * dot_incident_reports — accident/incident register (49 CFR 390.15; Full
 * DOT Compliance, Session 37). job_id / driver_id / truck_id are optional
 * (an incident may predate a dispatched job or involve an unassigned
 * unit). dot_reportable is the operator's recorded determination (a
 * recordable accident = fatality, injury treated away from scene, or a
 * vehicle towed from the scene). Defined in
 * packages/db/sql/0040_dot_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const dotIncidentSeverityValues = ['property_damage', 'injury', 'fatality'] as const;
export type DotIncidentSeverity = (typeof dotIncidentSeverityValues)[number];

export const dotIncidentReports = pgTable(
  'dot_incident_reports',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    truckId: uuid('truck_id').references(() => trucks.id, { onDelete: 'set null' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    locationText: text('location_text'),
    severity: text('severity', { enum: dotIncidentSeverityValues })
      .notNull()
      .default('property_damage'),
    fatalities: integer('fatalities').notNull().default(0),
    injuries: integer('injuries').notNull().default(0),
    hazmatRelease: boolean('hazmat_release').notNull().default(false),
    towedAway: boolean('towed_away').notNull().default(false),
    narrative: text('narrative'),
    dotReportable: boolean('dot_reportable').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantOccurredIdx: index('dot_incident_reports_tenant_occurred_idx')
      .on(t.tenantId, t.occurredAt)
      .where(sql`deleted_at IS NULL`),
    tenantReportableIdx: index('dot_incident_reports_tenant_reportable_idx')
      .on(t.tenantId, t.dotReportable)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DotIncidentReport = typeof dotIncidentReports.$inferSelect;
export type NewDotIncidentReport = typeof dotIncidentReports.$inferInsert;
