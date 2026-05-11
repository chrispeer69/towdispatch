/**
 * Reporting module contracts — Session 14.
 *
 * Eight report categories. Each report exposes:
 *   - GET /reporting/{id}/summary — top-line KPI tile for the dashboard
 *   - GET /reporting/{id}        — full data with filters and pagination
 *   - POST /reporting/{id}/export — CSV/PDF export descriptor
 *
 * Filters are kept generic via a `commonReportFiltersSchema` that every
 * report extends. Money is always integer cents, percents are 0–1.
 */
import { z } from 'zod';

export const REPORT_IDS = {
  DISPATCH: 'dispatch',
  DRIVER: 'driver',
  REVENUE: 'revenue',
  STORAGE: 'storage',
  PNL: 'pnl',
  COMMISSION: 'commission',
  TAX: 'tax',
  COMPLIANCE: 'compliance',
} as const;

export type ReportId = (typeof REPORT_IDS)[keyof typeof REPORT_IDS];
export const REPORT_ID_VALUES = [
  REPORT_IDS.DISPATCH,
  REPORT_IDS.DRIVER,
  REPORT_IDS.REVENUE,
  REPORT_IDS.STORAGE,
  REPORT_IDS.PNL,
  REPORT_IDS.COMMISSION,
  REPORT_IDS.TAX,
  REPORT_IDS.COMPLIANCE,
] as const;

export const reportIdSchema = z.enum(REPORT_ID_VALUES);

export const reportGranularityValues = ['day', 'week', 'month'] as const;
export type ReportGranularity = (typeof reportGranularityValues)[number];

export const reportComparisonValues = ['none', 'prior_period', 'prior_year'] as const;
export type ReportComparison = (typeof reportComparisonValues)[number];

/**
 * Every report accepts the same baseline filters. Date range defaults to the
 * current calendar month when omitted (resolved server-side). `comparison`
 * drives the prior-period overlay on time-series charts.
 */
export const commonReportFiltersSchema = z.object({
  from: z
    .string()
    .datetime()
    .optional()
    .describe('ISO start of window (inclusive). Defaults to start of month.'),
  to: z
    .string()
    .datetime()
    .optional()
    .describe('ISO end of window (exclusive). Defaults to now.'),
  granularity: z.enum(reportGranularityValues).default('day'),
  comparison: z.enum(reportComparisonValues).default('none'),
  /** Optional list of driver IDs to filter by. */
  driverIds: z.array(z.string().uuid()).optional(),
  /** Optional list of account IDs (motor clubs / commercial). */
  accountIds: z.array(z.string().uuid()).optional(),
  /** Optional service types. */
  serviceTypes: z.array(z.string()).optional(),
  /** Cursor for paginated lists. Opaque to the client. */
  cursor: z.string().optional(),
  /** Page size; cap at 200 to keep the wire bounded. */
  limit: z.number().int().min(1).max(200).default(50),
});

export type CommonReportFilters = z.infer<typeof commonReportFiltersSchema>;

/* -------------------------------------------------------------------- *
 * KPI shapes — every report's /summary endpoint returns one of these.  *
 * -------------------------------------------------------------------- */

export interface KpiValue {
  label: string;
  /** Display-ready value (already formatted server-side). */
  value: string;
  /** Optional change vs comparison period; positive = up. */
  changePct?: number | null;
  /** Hint for the UI: good/bad/neutral when up. */
  trend?: 'good' | 'bad' | 'neutral';
}

export interface ReportSummary {
  reportId: ReportId;
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  kpis: KpiValue[];
}

/* -------------------------------------------------------------------- *
 * Time-series and breakdown rows used across reports.                  *
 * -------------------------------------------------------------------- */

export interface TimeSeriesPoint {
  /** ISO date (day-level) or month label depending on granularity. */
  bucket: string;
  value: number;
  /** Prior-period overlay value, when comparison is non-none. */
  priorValue?: number | null;
}

export interface BreakdownRow {
  label: string;
  /** A reference key for the row — driver id, account id, ZIP, etc. */
  refId?: string | null;
  value: number;
  /** Optional secondary metric (e.g. count when value=revenue). */
  secondary?: number | null;
}

/* -------------------------------------------------------------------- *
 * Full responses for each report's main endpoint.                       *
 * -------------------------------------------------------------------- */

export interface ReportPage<TRow> {
  rows: TRow[];
  /** Opaque cursor for the next page; null when there are no more rows. */
  nextCursor: string | null;
  /** Total row count when feasible to compute; null otherwise. */
  total: number | null;
}

export interface DispatchPerformanceRow {
  dispatcherId: string;
  dispatcherName: string;
  jobsTotal: number;
  goaCount: number;
  goaRate: number;
  avgCallToDispatchSec: number | null;
  avgOnSceneSec: number | null;
  etaAccuracyPct: number | null;
}

export interface DriverPerformanceRow {
  driverId: string;
  driverName: string;
  jobsCompleted: number;
  jobsPerDay: number;
  revenueCents: number;
  onTimePct: number | null;
  avgRating: number | null;
  damageIncidents: number;
  goaRate: number;
  hoursWorked: number | null;
  jobsPerHour: number | null;
}

export interface RevenueRow {
  /** Service type, source, account, motor club, or ZIP — depending on dimension. */
  dimensionKey: string;
  label: string;
  revenueCents: number;
  jobs: number;
  priorRevenueCents?: number | null;
}

export const revenueDimensionValues = [
  'service_type',
  'source',
  'account',
  'motor_club',
  'zip',
  'time',
] as const;
export type RevenueDimension = (typeof revenueDimensionValues)[number];

export interface StorageRow {
  vehicleId: string;
  vehicleLabel: string;
  jobNumber: string;
  daysInYard: number;
  accruedFeesCents: number;
  invoicedFeesCents: number;
  outstandingCents: number;
  yard: string | null;
}

export interface PnlRow {
  dimensionKey: string;
  label: string;
  revenueCents: number;
  driverCommissionCents: number;
  fuelCostCents: number;
  truckDepreciationCents: number;
  motorClubFeesCents: number;
  netCents: number;
}

export const pnlDimensionValues = ['job', 'truck', 'driver', 'yard'] as const;
export type PnlDimension = (typeof pnlDimensionValues)[number];

export interface CommissionLineRow {
  driverId: string;
  driverName: string;
  payPeriodKey: string;
  jobsCount: number;
  grossRevenueCents: number;
  commissionBaseCents: number;
  multiplier: number;
  bonusCents: number;
  deductionCents: number;
  netCents: number;
}

export interface CommissionAuditRow {
  jobId: string;
  jobNumber: string;
  serviceType: string;
  completedAt: string | null;
  revenueCents: number;
  rate: number;
  base: 'gross' | 'net';
  multiplier: number;
  bonusCents: number;
  deductionCents: number;
  netCents: number;
}

export interface TaxRow {
  jurisdiction: string;
  taxName: string;
  taxableSalesCents: number;
  exemptSalesCents: number;
  taxCollectedCents: number;
  invoiceCount: number;
}

export interface ComplianceRow {
  category: 'hos' | 'license' | 'medical' | 'cdl' | 'coi' | 'hold_vehicle';
  refId: string;
  subject: string;
  detail: string;
  /** Days until expiry / over threshold. Negative when already overdue. */
  daysToBreach: number | null;
  severity: 'info' | 'warn' | 'critical';
}

/* -------------------------------------------------------------------- *
 * Saved reports and scheduled email delivery.                          *
 * -------------------------------------------------------------------- */

export const reportScheduleCadenceValues = ['daily', 'weekly', 'monthly'] as const;
export type ReportScheduleCadence = (typeof reportScheduleCadenceValues)[number];

export const reportExportFormatValues = ['csv', 'pdf'] as const;
export type ReportExportFormat = (typeof reportExportFormatValues)[number];

export const saveReportSchema = z.object({
  name: z.string().min(1).max(200),
  reportId: reportIdSchema,
  filters: z.record(z.unknown()),
  description: z.string().max(2000).optional().nullable(),
});

export type SaveReportPayload = z.infer<typeof saveReportSchema>;

export const scheduleReportSchema = z.object({
  savedReportId: z.string().uuid(),
  cadence: z.enum(reportScheduleCadenceValues),
  /** Hour of day (UTC) to deliver. */
  hourUtc: z.number().int().min(0).max(23).default(13),
  format: z.enum(reportExportFormatValues).default('pdf'),
  recipients: z.array(z.string().email()).min(1).max(20),
});

export type ScheduleReportPayload = z.infer<typeof scheduleReportSchema>;

export const exportReportSchema = z.object({
  format: z.enum(reportExportFormatValues),
  filters: z.record(z.unknown()).default({}),
});

export type ExportReportPayload = z.infer<typeof exportReportSchema>;

export interface ExportResponse {
  /**
   * Pre-signed URL the browser can hit directly. Issued by StorageProvider
   * (S3 in prod, local stub in dev). Expires in 5 minutes.
   */
  url: string;
  filename: string;
  format: ReportExportFormat;
  bytes: number;
  expiresAt: string;
}

export interface SavedReportDto {
  id: string;
  name: string;
  reportId: ReportId;
  description: string | null;
  filters: Record<string, unknown>;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportScheduleDto {
  id: string;
  savedReportId: string;
  cadence: ReportScheduleCadence;
  hourUtc: number;
  format: ReportExportFormat;
  recipients: string[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------- *
 * RBAC matrix — referenced by the API and rendered on the docs page.   *
 * -------------------------------------------------------------------- */

export const REPORT_ACCESS: Record<ReportId, readonly string[]> = {
  dispatch: ['owner', 'admin', 'manager', 'dispatcher', 'auditor'],
  driver: ['owner', 'admin', 'manager', 'dispatcher', 'driver', 'auditor'],
  revenue: ['owner', 'admin', 'manager', 'accounting', 'auditor'],
  storage: ['owner', 'admin', 'manager', 'accounting', 'auditor'],
  pnl: ['owner', 'admin', 'manager', 'auditor'],
  commission: ['owner', 'admin', 'manager', 'accounting', 'auditor', 'driver'],
  tax: ['owner', 'admin', 'manager', 'accounting', 'auditor'],
  compliance: ['owner', 'admin', 'manager', 'dispatcher', 'auditor'],
} as const;

/**
 * Drivers only ever see their own row in driver-performance and only their
 * own pay in commission. The API enforces this by injecting a driver filter
 * when the caller's role is `driver`.
 */
export function canAccessReport(role: string, reportId: ReportId): boolean {
  return REPORT_ACCESS[reportId].includes(role);
}
