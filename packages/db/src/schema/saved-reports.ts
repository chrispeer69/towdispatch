/**
 * saved_reports — Session 14, the user's stash of report configurations.
 *
 * The row holds:
 *   - which report (report_id literal)
 *   - the filter shape the user picked (jsonb — validated by Zod when read)
 *   - a friendly name + optional description
 *   - the owner (so RLS narrows visibility to the user; managers can see
 *     all rows in the tenant via the wider RLS policy in 0016 SQL)
 *
 * report_schedules carries the cron-ish cadence + recipients. A schedule
 * always references a saved_report so the same email can be re-rendered
 * months later under whatever filters the user originally locked in.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const reportScheduleCadenceValues = ['daily', 'weekly', 'monthly'] as const;
export type ReportScheduleCadence = (typeof reportScheduleCadenceValues)[number];

export const reportExportFormatValues = ['csv', 'pdf'] as const;
export type ReportExportFormat = (typeof reportExportFormatValues)[number];

export const savedReports = pgTable(
  'saved_reports',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),

    /** Report category identifier — matches REPORT_IDS in shared/reporting. */
    reportId: text('report_id').notNull(),

    /** Filter payload — opaque jsonb; service validates with the report's filter schema. */
    filters: jsonb('filters').notNull(),

    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantOwnerIdx: index('saved_reports_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    tenantReportIdx: index('saved_reports_tenant_report_idx').on(t.tenantId, t.reportId),
  }),
);

export type SavedReport = typeof savedReports.$inferSelect;
export type NewSavedReport = typeof savedReports.$inferInsert;

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    savedReportId: uuid('saved_report_id')
      .notNull()
      .references(() => savedReports.id, { onDelete: 'cascade' }),

    cadence: text('cadence', { enum: reportScheduleCadenceValues }).notNull(),
    hourUtc: bigint('hour_utc', { mode: 'number' }).notNull().default(13),
    format: text('format', { enum: reportExportFormatValues }).notNull().default('pdf'),
    /** Array of email addresses. */
    recipients: jsonb('recipients').notNull().default('[]'),

    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantNextRunIdx: index('report_schedules_tenant_next_run_idx').on(t.tenantId, t.nextRunAt),
    tenantSavedIdx: index('report_schedules_tenant_saved_idx').on(t.tenantId, t.savedReportId),
  }),
);

export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type NewReportSchedule = typeof reportSchedules.$inferInsert;
