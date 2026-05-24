/**
 * Reporting builder + KPI dashboard infrastructure — Session 53.
 *
 * Additive to Session 14's reporting schema (./reporting.ts). These tables back
 * the *custom report builder* and the *KPI dashboard*; they do not touch
 * saved_reports / report_schedules / report_runs.
 *
 *   report_templates           — base entity + allowlisted fields + filters +
 *                                 group-by + sort, compiled to SQL at run time.
 *   report_template_schedules  — separate scheduling lane for templates
 *                                 (NOT the 0037 lane — see SESSION_53_DECISIONS D2).
 *   report_template_runs       — append-only history of template renders.
 *   kpi_dashboard_layouts      — per-user, per-tenant widget grid layout.
 *   kpi_widget_catalog         — GLOBAL reference catalog (no tenant, no RLS).
 *
 * All tenant tables are FORCE RLS + audited. SQL: sql/0051_reporting_builder.sql.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const reportBaseEntityValues = [
  'jobs',
  'invoices',
  'accounts',
  'impound',
  'lien_cases',
  'drivers',
  'trucks',
] as const;
export type ReportBaseEntity = (typeof reportBaseEntityValues)[number];

export const reportTemplateScheduleCadenceValues = ['daily', 'weekly', 'monthly'] as const;
export type ReportTemplateScheduleCadence = (typeof reportTemplateScheduleCadenceValues)[number];

/** XLSX deferred this session (see D4) — CSV/PDF only. */
export const reportTemplateFormatValues = ['csv', 'pdf'] as const;
export type ReportTemplateFormat = (typeof reportTemplateFormatValues)[number];

export const reportTemplateRunStatusValues = ['pending', 'running', 'succeeded', 'failed'] as const;
export type ReportTemplateRunStatus = (typeof reportTemplateRunStatusValues)[number];

export const reportTemplates = pgTable(
  'report_templates',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    baseEntity: text('base_entity', { enum: reportBaseEntityValues }).notNull(),
    /** Allowlisted field keys to project, in display order. */
    selectedFields: jsonb('selected_fields').notNull().default([]),
    /** Array of { field, op, value } — each value binds as a parameter. */
    filters: jsonb('filters').notNull().default([]),
    /** Array of field keys to GROUP BY. */
    groupBy: jsonb('group_by').notNull().default([]),
    /** Array of { field, dir }. */
    sort: jsonb('sort').notNull().default([]),
    isSharedWithTenant: boolean('is_shared_with_tenant').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantNameUnique: uniqueIndex('report_templates_tenant_name_unique').on(t.tenantId, t.name),
    tenantSharedIdx: index('report_templates_tenant_shared_idx').on(
      t.tenantId,
      t.isSharedWithTenant,
    ),
  }),
);

export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type NewReportTemplate = typeof reportTemplates.$inferInsert;

export const reportTemplateSchedules = pgTable(
  'report_template_schedules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => reportTemplates.id, { onDelete: 'cascade' }),
    cadence: text('cadence', { enum: reportTemplateScheduleCadenceValues }).notNull(),
    /** Local wall-clock delivery time; tenant timezone applied at compute. */
    deliveryAtLocal: time('delivery_at_local').notNull().default('06:00'),
    /** 0=Sunday..6=Saturday, weekly only. */
    deliveryDow: smallint('delivery_dow'),
    /** 1..28, monthly only. */
    deliveryDom: smallint('delivery_dom'),
    recipients: jsonb('recipients').notNull().default([]),
    format: text('format', { enum: reportTemplateFormatValues }).notNull().default('csv'),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    templateUnique: uniqueIndex('report_template_schedules_template_unique').on(
      t.tenantId,
      t.templateId,
    ),
    dueIdx: index('report_template_schedules_due_idx').on(t.tenantId, t.enabled, t.nextRunAt),
  }),
);

export type ReportTemplateSchedule = typeof reportTemplateSchedules.$inferSelect;
export type NewReportTemplateSchedule = typeof reportTemplateSchedules.$inferInsert;

export const reportTemplateRuns = pgTable(
  'report_template_runs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id').references(() => reportTemplates.id, {
      onDelete: 'set null',
    }),
    scheduleId: uuid('schedule_id').references(() => reportTemplateSchedules.id, {
      onDelete: 'set null',
    }),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: reportTemplateRunStatusValues }).notNull().default('pending'),
    format: text('format', { enum: reportTemplateFormatValues }).notNull().default('csv'),
    rowCount: integer('row_count').notNull().default(0),
    storageKey: text('storage_key'),
    errorText: text('error_text'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCreatedIdx: index('report_template_runs_tenant_created_idx').on(t.tenantId, t.createdAt),
    templateIdx: index('report_template_runs_template_idx').on(
      t.tenantId,
      t.templateId,
      t.createdAt,
    ),
  }),
);

export type ReportTemplateRun = typeof reportTemplateRuns.$inferSelect;
export type NewReportTemplateRun = typeof reportTemplateRuns.$inferInsert;

export const kpiDashboardLayouts = pgTable(
  'kpi_dashboard_layouts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Array of { widget_id, x, y, w, h, config }. */
    layout: jsonb('layout').notNull().default([]),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantUserUnique: uniqueIndex('kpi_dashboard_layouts_tenant_user_unique').on(
      t.tenantId,
      t.userId,
    ),
  }),
);

export type KpiDashboardLayout = typeof kpiDashboardLayouts.$inferSelect;
export type NewKpiDashboardLayout = typeof kpiDashboardLayouts.$inferInsert;

/** Global reference catalog — no tenant_id, no RLS (read-only to app_user). */
export const kpiWidgetCatalog = pgTable('kpi_widget_catalog', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('operations'),
  defaultW: smallint('default_w').notNull().default(1),
  defaultH: smallint('default_h').notNull().default(1),
  configSchema: jsonb('config_schema').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type KpiWidgetCatalogRow = typeof kpiWidgetCatalog.$inferSelect;
export type NewKpiWidgetCatalogRow = typeof kpiWidgetCatalog.$inferInsert;
