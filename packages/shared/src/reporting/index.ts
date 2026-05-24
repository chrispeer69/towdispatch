/**
 * Reporting builder + KPI dashboard + P&L + aging — Session 53 wire contracts.
 *
 * Additive to schemas/reporting.ts (Session 14, the canned-reporter lane). Every
 * symbol here is prefixed (ReportTemplate*, Kpi*, Pnl*, Aging*) so it never
 * collides with the Session 14 ReportId / report-summary contracts that are also
 * exported from @ustowdispatch/shared.
 *
 * Money is integer cents. Percentages are 0..100 numbers. Dates are ISO 8601.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entity registry (builder)
// ---------------------------------------------------------------------------

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

/** The value kind of a queryable field — drives the UI control + filter ops. */
export const reportFieldKindValues = [
  'string',
  'number',
  'cents',
  'boolean',
  'date',
  'enum',
] as const;
export type ReportFieldKind = (typeof reportFieldKindValues)[number];

export const reportFilterOpValues = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'between',
  'is_null',
  'not_null',
] as const;
export type ReportFilterOp = (typeof reportFilterOpValues)[number];

/** A single queryable field as advertised to the builder UI. */
export const entityFieldMetaSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(reportFieldKindValues),
  /** Whether this field may be grouped on. */
  groupable: z.boolean().default(true),
  /** Whether this field may be aggregated (numeric/cents only). */
  aggregatable: z.boolean().default(false),
  /** For kind === 'enum', the allowed values. */
  enumValues: z.array(z.string()).optional(),
});
export type EntityFieldMeta = z.infer<typeof entityFieldMetaSchema>;

export const entityMetaSchema = z.object({
  entity: z.enum(reportBaseEntityValues),
  label: z.string(),
  fields: z.array(entityFieldMetaSchema),
});
export type EntityMeta = z.infer<typeof entityMetaSchema>;

// ---------------------------------------------------------------------------
// Report template (builder definition)
// ---------------------------------------------------------------------------

export const reportFilterSchema = z.object({
  field: z.string().min(1).max(80),
  op: z.enum(reportFilterOpValues),
  /** Bound as a parameter; never concatenated. Shape validated per op server-side. */
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const reportSortSchema = z.object({
  field: z.string().min(1).max(80),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type ReportSort = z.infer<typeof reportSortSchema>;

export const reportTemplateBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  baseEntity: z.enum(reportBaseEntityValues),
  selectedFields: z.array(z.string().min(1).max(80)).min(1).max(50),
  filters: z.array(reportFilterSchema).max(25).default([]),
  groupBy: z.array(z.string().min(1).max(80)).max(10).default([]),
  sort: z.array(reportSortSchema).max(10).default([]),
  isSharedWithTenant: z.boolean().default(false),
});
export type ReportTemplateBody = z.infer<typeof reportTemplateBodySchema>;

export const updateReportTemplateSchema = reportTemplateBodySchema.partial();
export type UpdateReportTemplatePayload = z.infer<typeof updateReportTemplateSchema>;

export const reportTemplateDtoSchema = reportTemplateBodySchema.extend({
  id: z.string().uuid(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schedule: z
    .object({
      id: z.string().uuid(),
      cadence: z.enum(['daily', 'weekly', 'monthly']),
      deliveryAtLocal: z.string(),
      deliveryDow: z.number().int().min(0).max(6).nullable(),
      deliveryDom: z.number().int().min(1).max(28).nullable(),
      recipients: z.array(z.string().email()),
      format: z.enum(['csv', 'pdf']),
      enabled: z.boolean(),
      nextRunAt: z.string().datetime().nullable(),
      lastRunAt: z.string().datetime().nullable(),
      lastStatus: z.string().nullable(),
    })
    .nullable(),
});
export type ReportTemplateDto = z.infer<typeof reportTemplateDtoSchema>;

/** Result of an interactive (synchronous) template run. */
export const executeReportResultSchema = z.object({
  /** Null for an ad-hoc preview run that has not been saved as a template. */
  templateId: z.string().uuid().nullable(),
  generatedAt: z.string().datetime(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  totalCount: z.number().int().nonnegative(),
  /** True when the result hit the row cap and was truncated. */
  truncated: z.boolean(),
  /** Set when truncated — tells the UI to offer an async scheduled run. */
  note: z.string().nullable(),
});
export type ExecuteReportResult = z.infer<typeof executeReportResultSchema>;

/** Max rows returned synchronously (see D3). */
export const REPORT_ROW_CAP = 50_000;

/** Ad-hoc preview run (builder preview pane) — a spec without a saved name. */
export const reportPreviewSchema = z.object({
  baseEntity: z.enum(reportBaseEntityValues),
  selectedFields: z.array(z.string().min(1).max(80)).min(1).max(50),
  filters: z.array(reportFilterSchema).max(25).default([]),
  groupBy: z.array(z.string().min(1).max(80)).max(10).default([]),
  sort: z.array(reportSortSchema).max(10).default([]),
});
export type ReportPreviewPayload = z.infer<typeof reportPreviewSchema>;

export const reportRunNowSchema = z.object({
  format: z.enum(['csv', 'pdf']).default('csv'),
});
export type ReportRunNowPayload = z.infer<typeof reportRunNowSchema>;

// ---------------------------------------------------------------------------
// Schedules + runs
// ---------------------------------------------------------------------------

export const reportTemplateScheduleBodySchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  deliveryAtLocal: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h')
    .default('06:00'),
  deliveryDow: z.number().int().min(0).max(6).nullish(),
  deliveryDom: z.number().int().min(1).max(28).nullish(),
  recipients: z.array(z.string().email()).min(1).max(20),
  format: z.enum(['csv', 'pdf']).default('csv'),
  enabled: z.boolean().default(true),
});
export type ReportTemplateScheduleBody = z.infer<typeof reportTemplateScheduleBodySchema>;

export const reportTemplateRunDtoSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  scheduleId: z.string().uuid().nullable(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  format: z.enum(['csv', 'pdf']),
  rowCount: z.number().int().nonnegative(),
  errorText: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  /** Signed download link, present only when status === 'succeeded'. */
  downloadUrl: z.string().nullable(),
});
export type ReportTemplateRunDto = z.infer<typeof reportTemplateRunDtoSchema>;

// ---------------------------------------------------------------------------
// KPI dashboard
// ---------------------------------------------------------------------------

export const kpiWidgetIdValues = [
  'jobs_today',
  'revenue_mtd',
  'revenue_ytd',
  'goa_rate_7d',
  'avg_eta_7d',
  'open_impound_count',
  'lien_due_30d',
  'accounts_aging_total',
  'top_5_accounts_revenue_mtd',
  'top_5_motor_clubs_revenue_mtd',
  'driver_count_active',
  'truck_count_active',
] as const;
export type KpiWidgetId = (typeof kpiWidgetIdValues)[number];

export const kpiWidgetCatalogDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  defaultW: z.number().int().positive(),
  defaultH: z.number().int().positive(),
  configSchema: z.record(z.unknown()),
});
export type KpiWidgetCatalogDto = z.infer<typeof kpiWidgetCatalogDtoSchema>;

/** A computed widget value. `series` carries the top-N tabular widgets. */
export const kpiValueDtoSchema = z.object({
  widgetId: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  /** "$", "%", "min", or null. */
  unit: z.string().nullable(),
  /** Optional comparison delta as a signed percent (e.g. +12.5). */
  deltaPct: z.number().nullable(),
  tone: z.enum(['ok', 'warn', 'danger', 'neutral']).default('neutral'),
  /** For top-N widgets: ordered rows of { label, value }. */
  series: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .nullable()
    .default(null),
  generatedAt: z.string().datetime(),
  note: z.string().nullable().default(null),
});
export type KpiValueDto = z.infer<typeof kpiValueDtoSchema>;

export const kpiLayoutEntrySchema = z.object({
  widgetId: z.enum(kpiWidgetIdValues),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(6),
  config: z.record(z.unknown()).default({}),
});
export type KpiLayoutEntry = z.infer<typeof kpiLayoutEntrySchema>;

export const kpiLayoutDtoSchema = z.object({
  layout: z.array(kpiLayoutEntrySchema),
  isDefault: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export type KpiLayoutDto = z.infer<typeof kpiLayoutDtoSchema>;

export const putKpiLayoutSchema = z.object({
  layout: z.array(kpiLayoutEntrySchema).max(40),
});
export type PutKpiLayoutPayload = z.infer<typeof putKpiLayoutSchema>;

// ---------------------------------------------------------------------------
// P&L (per-account / per-motor-club)
// ---------------------------------------------------------------------------

export const pnlRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  revenueCents: z.number().int(),
  commissionCents: z.number().int(),
  motorClubFeeCents: z.number().int(),
  /** Fuel + tolls + depreciation — 0 until those columns ship (see D5). */
  otherCogsCents: z.number().int(),
  marginCents: z.number().int(),
  jobCount: z.number().int().nonnegative(),
});
export type PnlRow = z.infer<typeof pnlRowSchema>;

export const pnlResponseSchema = z.object({
  dimension: z.enum(['accounts', 'motor-clubs']),
  from: z.string().datetime(),
  to: z.string().datetime(),
  rows: z.array(pnlRowSchema),
  totals: pnlRowSchema,
  notes: z.array(z.string()),
});
export type PnlResponse = z.infer<typeof pnlResponseSchema>;

// ---------------------------------------------------------------------------
// Aging (with drill-down)
// ---------------------------------------------------------------------------

export const agingReportRowSchema = z.object({
  accountId: z.string().uuid().nullable(),
  accountName: z.string(),
  balanceTotalCents: z.number().int(),
  balanceCurrentCents: z.number().int(),
  balance30Cents: z.number().int(),
  balance60Cents: z.number().int(),
  balance90PlusCents: z.number().int(),
  openInvoiceCount: z.number().int().nonnegative(),
});
export type AgingReportRow = z.infer<typeof agingReportRowSchema>;

export const agingReportResponseSchema = z.object({
  asOf: z.string().datetime(),
  bucketDays: z.array(z.number().int().positive()),
  rows: z.array(agingReportRowSchema),
  totals: agingReportRowSchema,
});
export type AgingReportResponse = z.infer<typeof agingReportResponseSchema>;

export const agingInvoiceRowSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  ageDays: z.number().int(),
  bucket: z.enum(['current', 'b1', 'b2', 'b3plus']),
  totalCents: z.number().int(),
  balanceCents: z.number().int(),
});
export type AgingInvoiceRow = z.infer<typeof agingInvoiceRowSchema>;

export const agingDrilldownResponseSchema = z.object({
  accountId: z.string().uuid(),
  asOf: z.string().datetime(),
  invoices: z.array(agingInvoiceRowSchema),
  balanceTotalCents: z.number().int(),
});
export type AgingDrilldownResponse = z.infer<typeof agingDrilldownResponseSchema>;
