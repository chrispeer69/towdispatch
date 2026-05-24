/**
 * Reporting infrastructure — Session 14.
 *
 *   saved_reports     — A user-named, persisted report configuration.
 *                       Replayed verbatim every time someone re-opens it.
 *   report_schedules  — Optional 1:1 attachment to a saved_report that
 *                       emails the rendered output on a daily/weekly/monthly
 *                       cadence.
 *   report_runs       — Append-only history of every (interactive +
 *                       scheduled) render. Powers the "Last run" indicator
 *                       and the basic audit trail in the saved-reports list.
 *
 * All three are FORCE RLS, audited via fn_audit_log, and per-tenant. SQL:
 * sql/0037_reporting.sql.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const reportFormatValues = ['csv', 'pdf'] as const;
export type ReportFormat = (typeof reportFormatValues)[number];

export const reportRunFormatValues = ['csv', 'pdf', 'interactive'] as const;
export type ReportRunFormat = (typeof reportRunFormatValues)[number];

export const reportRunStatusValues = ['success', 'failed'] as const;
export type ReportRunStatus = (typeof reportRunStatusValues)[number];

export const reportScheduleCadenceValues = ['daily', 'weekly', 'monthly'] as const;
export type ReportScheduleCadence = (typeof reportScheduleCadenceValues)[number];

export const savedReports = pgTable(
  'saved_reports',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Report category id — kept as text to avoid a tightly coupled Drizzle enum. */
    reportId: text('report_id').notNull(),
    name: text('name').notNull(),
    /** Filter values; replayed verbatim on every run. */
    filters: jsonb('filters').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantReportIdx: index('saved_reports_tenant_report_idx').on(t.tenantId, t.reportId),
    tenantNameUnique: uniqueIndex('saved_reports_tenant_name_unique').on(t.tenantId, t.name),
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
    format: text('format', { enum: reportFormatValues }).notNull(),
    /** Email recipients — array of validated addresses. */
    recipients: jsonb('recipients').notNull().default([]),
    active: boolean('active').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: text('last_run_status'),
    lastRunError: text('last_run_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    savedReportUnique: uniqueIndex('report_schedules_saved_report_unique').on(t.savedReportId),
    dueIdx: index('report_schedules_due_idx').on(t.tenantId, t.active, t.nextRunAt),
  }),
);

export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type NewReportSchedule = typeof reportSchedules.$inferInsert;

export const reportRuns = pgTable(
  'report_runs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    reportId: text('report_id').notNull(),
    savedReportId: uuid('saved_report_id').references(() => savedReports.id, {
      onDelete: 'set null',
    }),
    scheduleId: uuid('schedule_id').references(() => reportSchedules.id, { onDelete: 'set null' }),
    format: text('format', { enum: reportRunFormatValues }).notNull(),
    status: text('status', { enum: reportRunStatusValues }).notNull(),
    rowsEmitted: integer('rows_emitted').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    storageKey: text('storage_key'),
    error: text('error'),
    initiatedBy: uuid('initiated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('report_runs_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type ReportRun = typeof reportRuns.$inferSelect;
export type NewReportRun = typeof reportRuns.$inferInsert;
