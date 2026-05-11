/**
 * Internal types for the Reporting & Analytics module (Session 14).
 *
 * Kept apart from the wire schemas in @ustowdispatch/shared so we can let the
 * report implementations return strongly-typed intermediates without forcing
 * every shape to round-trip through zod. The controller maps the internal
 * shape to the public DTO.
 */
import type {
  BreakdownPoint,
  KpiTile,
  ReportComparison,
  ReportFiltersBase,
  ReportId,
  TimeSeriesPoint,
} from '@ustowdispatch/shared';

export interface AuthCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

/** Normalized filter window: every report resolves the optional dates into
 *  concrete UTC bounds and an optional comparison window the same way. */
export interface ResolvedReportWindow {
  fromDate: Date;
  toDate: Date;
  comparison: ReportComparison;
  comparisonFromDate: Date | null;
  comparisonToDate: Date | null;
}

export interface ReportFilters extends ReportFiltersBase {}

export interface ReportSummary {
  reportId: ReportId;
  headline: string;
  asOf: Date;
  kpis: KpiTile[];
}

export interface ReportDetail {
  reportId: ReportId;
  generatedAt: Date;
  kpis: KpiTile[];
  timeSeries: TimeSeriesPoint[];
  breakdown: BreakdownPoint[];
  rows: Array<Record<string, string | number | null | boolean>>;
  totalRows: number;
  nextCursor: string | null;
  notes: string[];
}

/**
 * Internal contract every report implements. The controller layer dispatches
 * to the right Reporter by ReportId and never invokes Drizzle directly.
 */
export interface Reporter {
  readonly id: ReportId;
  summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary>;
  detail(ctx: AuthCtx, filters: ReportFilters): Promise<ReportDetail>;
}
