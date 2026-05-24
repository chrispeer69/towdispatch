/**
 * Reporting & Analytics — Session 14 contracts.
 *
 * Every report exposes three endpoints:
 *   /reporting/{report_id}/summary   — KPI tile (4–6 top-line numbers)
 *   /reporting/{report_id}           — full data: filters, breakdowns, table rows
 *   /reporting/{report_id}/export    — returns a download URL for csv/pdf
 *
 * Eight reports, identified by a string id ("dispatch-performance",
 * "driver-performance", "revenue", "storage", "pnl", "commission", "tax",
 * "compliance"). The id is part of the URL and is the cache key suffix.
 *
 * Money is integer cents; durations are integer seconds; rates / percentages
 * are numbers in the 0..100 range (not 0..1) to keep wire-side rendering
 * trivial. Money fields end in `_cents`, percent fields end in `_pct`.
 */
import { z } from 'zod';

export const reportIdValues = [
  'dispatch-performance',
  'driver-performance',
  'revenue',
  'storage',
  'pnl',
  'commission',
  'tax',
  'compliance',
] as const;
export type ReportId = (typeof reportIdValues)[number];

export const reportComparisonValues = ['none', 'prior_period', 'prior_year'] as const;
export type ReportComparison = (typeof reportComparisonValues)[number];

export const reportExportFormatValues = ['csv', 'pdf'] as const;
export type ReportExportFormat = (typeof reportExportFormatValues)[number];

export const reportScheduleCadenceValues = ['daily', 'weekly', 'monthly'] as const;
export type ReportScheduleCadence = (typeof reportScheduleCadenceValues)[number];

/**
 * Shared filter shape — every report accepts at least a date window. Reports
 * extend it with their own dimension filters (e.g. driverId, serviceType).
 * We send dates as ISO 8601 strings to keep timezone handling on the server.
 */
export const reportFiltersBaseSchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  comparison: z.enum(reportComparisonValues).default('none'),
  /** Optional dimension filters; each report uses what it understands. */
  driverId: z.string().uuid().optional(),
  truckId: z.string().uuid().optional(),
  dispatcherId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  serviceType: z.string().max(40).optional(),
  source: z.string().max(60).optional(),
  zip: z.string().max(20).optional(),
  jurisdiction: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  cursor: z.string().max(200).optional(),
});
export type ReportFiltersBase = z.infer<typeof reportFiltersBaseSchema>;

export const kpiTileSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  /** Optional secondary line for "vs prior" or units. */
  hint: z.string().nullable().optional(),
  /** "ok" | "warn" | "danger" — drives the colored chip on the tile. */
  tone: z.enum(['ok', 'warn', 'danger', 'neutral']).default('neutral'),
});
export type KpiTile = z.infer<typeof kpiTileSchema>;

export const reportSummaryDtoSchema = z.object({
  reportId: z.enum(reportIdValues),
  headline: z.string(),
  asOf: z.string().datetime(),
  kpis: z.array(kpiTileSchema),
});
export type ReportSummaryDto = z.infer<typeof reportSummaryDtoSchema>;

export const timeSeriesPointSchema = z.object({
  bucket: z.string(),
  value: z.number(),
  /** Optional second series value for prior-period overlay. */
  comparisonValue: z.number().nullable().optional(),
});
export type TimeSeriesPoint = z.infer<typeof timeSeriesPointSchema>;

export const breakdownPointSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  secondaryValue: z.number().nullable().optional(),
});
export type BreakdownPoint = z.infer<typeof breakdownPointSchema>;

export const reportDetailDtoSchema = z.object({
  reportId: z.enum(reportIdValues),
  generatedAt: z.string().datetime(),
  kpis: z.array(kpiTileSchema),
  timeSeries: z.array(timeSeriesPointSchema),
  breakdown: z.array(breakdownPointSchema),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null(), z.boolean()]))),
  totalRows: z.number().int().nonnegative(),
  /** Cursor pagination — null when no more rows. */
  nextCursor: z.string().nullable(),
  notes: z.array(z.string()).default([]),
});
export type ReportDetailDto = z.infer<typeof reportDetailDtoSchema>;

export const exportReportPayloadSchema = z.object({
  format: z.enum(reportExportFormatValues),
  /** Filters are re-applied on the server to ensure RLS / RBAC stays honest. */
  filters: reportFiltersBaseSchema.partial().default({}),
});
export type ExportReportPayload = z.infer<typeof exportReportPayloadSchema>;

export const exportReportResponseSchema = z.object({
  url: z.string(),
  filename: z.string(),
  expiresAt: z.string().datetime(),
});
export type ExportReportResponse = z.infer<typeof exportReportResponseSchema>;

export const savedReportDtoSchema = z.object({
  id: z.string().uuid(),
  reportId: z.enum(reportIdValues),
  name: z.string(),
  filters: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schedule: z
    .object({
      id: z.string().uuid(),
      cadence: z.enum(reportScheduleCadenceValues),
      format: z.enum(reportExportFormatValues),
      recipients: z.array(z.string().email()),
      nextRunAt: z.string().datetime().nullable(),
      lastRunAt: z.string().datetime().nullable(),
      active: z.boolean(),
    })
    .nullable(),
});
export type SavedReportDto = z.infer<typeof savedReportDtoSchema>;

export const createSavedReportSchema = z.object({
  reportId: z.enum(reportIdValues),
  name: z.string().min(1).max(120),
  filters: z.record(z.unknown()).default({}),
  schedule: z
    .object({
      cadence: z.enum(reportScheduleCadenceValues),
      format: z.enum(reportExportFormatValues),
      recipients: z.array(z.string().email()).min(1).max(20),
    })
    .nullable()
    .optional(),
});
export type CreateSavedReportPayload = z.infer<typeof createSavedReportSchema>;

export const updateSavedReportSchema = createSavedReportSchema.partial();
export type UpdateSavedReportPayload = z.infer<typeof updateSavedReportSchema>;

/**
 * Human-readable titles. Used by the index page card, the detail page header,
 * the email subject of a scheduled run, and the PDF cover sheet.
 */
export const reportTitles: Record<ReportId, string> = {
  'dispatch-performance': 'Dispatch Performance',
  'driver-performance': 'Driver Performance',
  revenue: 'Revenue',
  storage: 'Storage & Impound',
  pnl: 'Profit & Loss',
  commission: 'Commission',
  tax: 'Tax',
  compliance: 'Compliance',
};

export const reportShortDescriptions: Record<ReportId, string> = {
  'dispatch-performance':
    'ETA accuracy, GOA rate, call-to-dispatch and on-scene latency, per-dispatcher volume.',
  'driver-performance': 'Jobs and revenue per driver, on-time arrival, customer rating, incidents.',
  revenue: 'Revenue by service, source, account, motor club, ZIP, time bucket — with prior period.',
  storage: 'Yard utilization, days-in-yard, projected lien revenue, storage A/R aging.',
  pnl: 'P&L by job, truck, driver, yard — revenue net of commission, fuel, depreciation, fees.',
  commission: 'Per-driver commission with full per-job audit trail and pay-period summaries.',
  tax: 'Sales tax collected by jurisdiction, exemption activity, monthly/quarterly export.',
  compliance: 'HOS exposure, expired credentials, missing COIs, hold-vehicle aging.',
};
