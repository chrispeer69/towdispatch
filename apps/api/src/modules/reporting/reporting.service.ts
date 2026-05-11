/**
 * ReportingService — dispatcher in front of the eight reporter implementations.
 *
 * Responsibilities:
 *   - Resolve the ReportId to a Reporter, throw 404 if unknown.
 *   - Enforce RBAC narrowing for drivers: a driver may only request their own
 *     row from driver-performance / commission. The Roles guard at the
 *     controller layer already filtered out reports they can't see at all.
 *   - Read-through 60s Redis cache, keyed by (tenantId, reportId, filterHash,
 *     variant).
 *   - Bookkeep report_runs for the audit log.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { drivers, reportRuns, uuidv7 } from '@ustowdispatch/db';
import type { ReportDetailDto, ReportId, ReportSummaryDto } from '@ustowdispatch/shared';
import { and, eq } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { ReportingCacheService } from './reporting-cache.service.js';
import { filterHash } from './reporting-window.js';
import type {
  AuthCtx,
  ReportDetail,
  ReportFilters,
  ReportSummary,
  Reporter,
} from './reporting.types.js';
import { CommissionReporter } from './reports/commission.reporter.js';
import { ComplianceReporter } from './reports/compliance.reporter.js';
import { DispatchPerformanceReporter } from './reports/dispatch-performance.reporter.js';
import { DriverPerformanceReporter } from './reports/driver-performance.reporter.js';
import { PnlReporter } from './reports/pnl.reporter.js';
import { RevenueReporter } from './reports/revenue.reporter.js';
import { StorageReporter } from './reports/storage.reporter.js';
import { TaxReporter } from './reports/tax.reporter.js';

@Injectable()
export class ReportingService {
  private readonly reporters: Map<ReportId, Reporter>;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly cache: ReportingCacheService,
    dispatch: DispatchPerformanceReporter,
    driver: DriverPerformanceReporter,
    revenue: RevenueReporter,
    storage: StorageReporter,
    pnl: PnlReporter,
    commission: CommissionReporter,
    tax: TaxReporter,
    compliance: ComplianceReporter,
  ) {
    this.reporters = new Map<ReportId, Reporter>([
      [dispatch.id, dispatch],
      [driver.id, driver],
      [revenue.id, revenue],
      [storage.id, storage],
      [pnl.id, pnl],
      [commission.id, commission],
      [tax.id, tax],
      [compliance.id, compliance],
    ]);
  }

  reporterIds(): ReportId[] {
    return Array.from(this.reporters.keys());
  }

  async summary(
    ctx: AuthCtx,
    reportId: ReportId,
    filters: ReportFilters,
  ): Promise<ReportSummaryDto> {
    const adjusted = await this.narrowForDriverRole(ctx, reportId, filters);
    const cacheKey = `${reportId}:${ctx.tenantId}:${filterHash(adjusted)}:summary`;
    const cached = await this.cache.get<ReportSummaryDto>(cacheKey);
    if (cached) return cached;
    const reporter = this.requireReporter(reportId);
    const summary = await reporter.summary(ctx, adjusted);
    const dto = toSummaryDto(summary);
    await this.cache.set(cacheKey, dto);
    return dto;
  }

  async detail(ctx: AuthCtx, reportId: ReportId, filters: ReportFilters): Promise<ReportDetailDto> {
    const adjusted = await this.narrowForDriverRole(ctx, reportId, filters);
    const cacheKey = `${reportId}:${ctx.tenantId}:${filterHash(adjusted)}:detail`;
    const cached = await this.cache.get<ReportDetailDto>(cacheKey);
    if (cached) return cached;
    const reporter = this.requireReporter(reportId);
    const start = Date.now();
    const detail = await reporter.detail(ctx, adjusted);
    const elapsed = Date.now() - start;
    const dto = toDetailDto(detail);
    await this.cache.set(cacheKey, dto);
    await this.logRun(ctx, reportId, 'interactive', 'success', detail.totalRows, elapsed, null);
    return dto;
  }

  /**
   * Render the detail for any report — used by the export pipeline and the
   * scheduler. Skips the cache so a scheduled run never reads stale data, and
   * never logs a row twice (the scheduler logs its own report_run).
   */
  async detailRaw(ctx: AuthCtx, reportId: ReportId, filters: ReportFilters): Promise<ReportDetail> {
    const adjusted = await this.narrowForDriverRole(ctx, reportId, filters);
    const reporter = this.requireReporter(reportId);
    return reporter.detail(ctx, adjusted);
  }

  /**
   * Invalidate cached entries for a category of report (called by upstream
   * services on entity writes, e.g. invoice created → revenue / tax).
   */
  async invalidate(tenantId: string, reportId: ReportId): Promise<void> {
    await this.cache.invalidateReport(tenantId, reportId);
  }

  private requireReporter(id: ReportId): Reporter {
    const r = this.reporters.get(id);
    if (!r) throw new NotFoundException(`Unknown report: ${id}`);
    return r;
  }

  /**
   * Driver role narrowing. A 'driver' caller may only see their own data on
   * driver-performance / commission. For other reports, the controller's
   * role allowlist already blocks the route.
   */
  private async narrowForDriverRole(
    ctx: AuthCtx,
    reportId: ReportId,
    filters: ReportFilters,
  ): Promise<ReportFilters> {
    if (ctx.role !== 'driver') return filters;
    // Lookup driverId by userId. If the driver isn't found we return a
    // filter that matches no rows by setting an impossible UUID.
    return this.db.runInTenantContext(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
      },
      async (tx) => {
        const row = await tx.query.drivers.findFirst({
          where: and(eq(drivers.userId, ctx.userId)),
          columns: { id: true },
        });
        const driverId = row?.id ?? '00000000-0000-0000-0000-000000000000';
        if (reportId === 'driver-performance' || reportId === 'commission') {
          return { ...filters, driverId };
        }
        return filters;
      },
    );
  }

  async logRun(
    ctx: AuthCtx,
    reportId: ReportId,
    format: 'interactive' | 'csv' | 'pdf',
    status: 'success' | 'failed',
    rowsEmitted: number,
    durationMs: number,
    storageKey: string | null,
    opts: { savedReportId?: string | null; scheduleId?: string | null; error?: string | null } = {},
  ): Promise<void> {
    await this.db.runInTenantContext(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
      },
      async (tx) => {
        await tx.insert(reportRuns).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          reportId,
          format,
          status,
          rowsEmitted,
          durationMs,
          storageKey,
          savedReportId: opts.savedReportId ?? null,
          scheduleId: opts.scheduleId ?? null,
          initiatedBy: ctx.userId,
          error: opts.error ?? null,
        });
      },
    );
  }
}

function toSummaryDto(s: ReportSummary): ReportSummaryDto {
  return {
    reportId: s.reportId,
    headline: s.headline,
    asOf: s.asOf.toISOString(),
    kpis: s.kpis,
  };
}

function toDetailDto(d: ReportDetail): ReportDetailDto {
  return {
    reportId: d.reportId,
    generatedAt: d.generatedAt.toISOString(),
    kpis: d.kpis,
    timeSeries: d.timeSeries,
    breakdown: d.breakdown,
    rows: d.rows,
    totalRows: d.totalRows,
    nextCursor: d.nextCursor,
    notes: d.notes,
  };
}
