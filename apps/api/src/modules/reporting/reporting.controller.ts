/**
 * ReportingController — surface for the eight report categories plus
 * saved-reports / schedules.
 *
 * Endpoint pattern (per the Session 14 spec):
 *   GET  /reporting/{report_id}/summary    KPI tile
 *   GET  /reporting/{report_id}            paginated rows + chart payload
 *   POST /reporting/{report_id}/export     CSV/PDF, returns signed URL
 *   GET  /reporting/saved                  list saved reports
 *   POST /reporting/saved                  save a report
 *   DELETE /reporting/saved/:id            soft-delete a saved report
 *   POST /reporting/saved/:id/schedule     create a schedule
 *   GET  /reporting/schedules              list schedules
 *   DELETE /reporting/schedules/:id        cancel a schedule
 *
 * Auth: every endpoint is JwtAuthGuard-protected (via APP_GUARD).
 * Role: RolesGuard enforces the matrix from shared/reporting.REPORT_ACCESS.
 */
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CommonReportFilters,
  type ExportReportPayload,
  type ExportResponse,
  REPORT_IDS,
  type ReportId,
  type ReportPage,
  type ReportScheduleDto,
  type ReportSummary,
  ROLES,
  type SavedReportDto,
  type SaveReportPayload,
  type ScheduleReportPayload,
  canAccessReport,
  commonReportFiltersSchema,
  exportReportSchema,
  reportIdSchema,
  saveReportSchema,
  scheduleReportSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ReportExportService } from './export.service.js';
import { ReportingCacheService } from './reporting-cache.service.js';
import type { ReportContext } from './reporting-read.service.js';
import { SavedReportsService } from './saved-reports.service.js';
import { CommissionReportService } from './services/commission.report.service.js';
import { ComplianceReportService } from './services/compliance.report.service.js';
import { DispatchReportService } from './services/dispatch.report.service.js';
import { DriverReportService } from './services/driver.report.service.js';
import { PnlReportService } from './services/pnl.report.service.js';
import { RevenueReportService } from './services/revenue.report.service.js';
import { StorageReportService } from './services/storage.report.service.js';
import { TaxReportService } from './services/tax.report.service.js';

const reportIdParamSchema = z.object({ reportId: reportIdSchema });
const savedIdSchema = z.object({ id: z.string().uuid() });
// Roles aren't first-class allowed for the auditor as a Nest decorator unless
// listed here. ALL_ROLES = every role we ship — the per-endpoint check below
// enforces report-specific access via canAccessReport().
const ALL_ROLES: ReadonlyArray<(typeof ROLES)[keyof typeof ROLES]> = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.DISPATCHER,
  ROLES.ACCOUNTING,
  ROLES.AUDITOR,
  ROLES.DRIVER,
];

@UseGuards(RolesGuard)
@Controller('reporting')
export class ReportingController {
  constructor(
    private readonly dispatch: DispatchReportService,
    private readonly driver: DriverReportService,
    private readonly revenue: RevenueReportService,
    private readonly storage: StorageReportService,
    private readonly pnl: PnlReportService,
    private readonly commission: CommissionReportService,
    private readonly tax: TaxReportService,
    private readonly compliance: ComplianceReportService,
    private readonly saved: SavedReportsService,
    private readonly cache: ReportingCacheService,
    private readonly exporter: ReportExportService,
  ) {}

  // ---------- saved reports + schedules ----------

  @Get('saved')
  @Roles(...ALL_ROLES)
  async listSaved(@Req() req: FastifyRequest): Promise<{ rows: SavedReportDto[] }> {
    const rows = await this.saved.list(this.ctx(req));
    return { rows };
  }

  @Post('saved')
  @Roles(...ALL_ROLES)
  async save(
    @ZodBody(saveReportSchema) body: SaveReportPayload,
    @Req() req: FastifyRequest,
  ): Promise<SavedReportDto> {
    const ctx = this.ctx(req);
    if (!canAccessReport(ctx.role ?? '', body.reportId)) {
      throw new ForbiddenException('You cannot save this report category');
    }
    return this.saved.save(ctx, body);
  }

  @Delete('saved/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(...ALL_ROLES)
  async deleteSaved(
    @ZodParam(savedIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    await this.saved.delete(this.ctx(req), params.id);
    return { ok: true };
  }

  @Post('saved/:id/schedule')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async schedule(
    @ZodParam(savedIdSchema) params: { id: string },
    @ZodBody(scheduleReportSchema.omit({ savedReportId: true })) body: Omit<
      ScheduleReportPayload,
      'savedReportId'
    >,
    @Req() req: FastifyRequest,
  ): Promise<ReportScheduleDto> {
    return this.saved.schedule(this.ctx(req), { ...body, savedReportId: params.id });
  }

  @Get('schedules')
  @Roles(...ALL_ROLES)
  async listSchedules(@Req() req: FastifyRequest): Promise<{ rows: ReportScheduleDto[] }> {
    const rows = await this.saved.listSchedules(this.ctx(req));
    return { rows };
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async cancelSchedule(
    @ZodParam(savedIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    await this.saved.cancelSchedule(this.ctx(req), params.id);
    return { ok: true };
  }

  // ---------- generic per-report endpoints ----------

  @Get(':reportId/summary')
  @Roles(...ALL_ROLES)
  async summary(
    @ZodParam(reportIdParamSchema) params: { reportId: ReportId },
    @ZodQuery(commonReportFiltersSchema) query: CommonReportFilters,
    @Req() req: FastifyRequest,
  ): Promise<ReportSummary> {
    const ctx = this.ctx(req);
    this.assertAccess(ctx.role, params.reportId);
    const cacheKey = this.cache.buildKey(ctx.tenantId, `${params.reportId}:summary`, query);
    const cached = await this.cache.get<ReportSummary>(cacheKey);
    if (cached) return cached;
    const result = await this.dispatchSummary(ctx, params.reportId, query);
    await this.cache.set(cacheKey, result);
    return result;
  }

  @Get(':reportId')
  @Roles(...ALL_ROLES)
  async details(
    @ZodParam(reportIdParamSchema) params: { reportId: ReportId },
    @ZodQuery(commonReportFiltersSchema) query: CommonReportFilters,
    @Req() req: FastifyRequest,
  ): Promise<ReportPage<unknown>> {
    const ctx = this.ctx(req);
    this.assertAccess(ctx.role, params.reportId);
    const cacheKey = this.cache.buildKey(ctx.tenantId, `${params.reportId}:list`, query);
    const cached = await this.cache.get<ReportPage<unknown>>(cacheKey);
    if (cached) return cached;
    const result = await this.dispatchList(ctx, params.reportId, query);
    await this.cache.set(cacheKey, result);
    return result;
  }

  @Post(':reportId/export')
  @Roles(...ALL_ROLES)
  async export(
    @ZodParam(reportIdParamSchema) params: { reportId: ReportId },
    @ZodBody(exportReportSchema) body: ExportReportPayload,
    @Req() req: FastifyRequest,
  ): Promise<ExportResponse> {
    const ctx = this.ctx(req);
    this.assertAccess(ctx.role, params.reportId);
    // Validate the embedded filters against the common shape — extra keys
    // are dropped silently by Zod's default strip mode, which is fine since
    // each report only consumes the fields it understands.
    const parsed = commonReportFiltersSchema.safeParse(body.filters);
    if (!parsed.success) {
      throw new BadRequestException('Invalid filters payload');
    }
    const input = await this.buildExportInput(ctx, params.reportId, parsed.data);
    return this.exporter.export({
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      reportId: params.reportId,
      reportTitle: prettyName(params.reportId),
      columns: input.columns,
      rows: input.rows,
      kpis: input.kpis,
      format: body.format,
    });
  }

  // ---------- dispatcher helpers ----------

  private async dispatchSummary(
    ctx: ReportContext,
    reportId: ReportId,
    filters: CommonReportFilters,
  ): Promise<ReportSummary> {
    switch (reportId) {
      case REPORT_IDS.DISPATCH:
        return this.dispatch.summary(ctx, filters);
      case REPORT_IDS.DRIVER:
        return this.driver.summary(ctx, filters);
      case REPORT_IDS.REVENUE:
        return this.revenue.summary(ctx, filters);
      case REPORT_IDS.STORAGE:
        return this.storage.summary(ctx, filters);
      case REPORT_IDS.PNL:
        return this.pnl.summary(ctx, filters);
      case REPORT_IDS.COMMISSION:
        return this.commission.summary(ctx, filters);
      case REPORT_IDS.TAX:
        return this.tax.summary(ctx, filters);
      case REPORT_IDS.COMPLIANCE:
        return this.compliance.summary(ctx, filters);
    }
  }

  private async dispatchList(
    ctx: ReportContext,
    reportId: ReportId,
    filters: CommonReportFilters,
  ): Promise<ReportPage<unknown>> {
    switch (reportId) {
      case REPORT_IDS.DISPATCH:
        return this.dispatch.list(ctx, filters);
      case REPORT_IDS.DRIVER:
        return this.driver.list(ctx, filters);
      case REPORT_IDS.REVENUE:
        return this.revenue.list(ctx, filters);
      case REPORT_IDS.STORAGE:
        return this.storage.list(ctx, filters);
      case REPORT_IDS.PNL:
        return this.pnl.list(ctx, filters);
      case REPORT_IDS.COMMISSION:
        return this.commission.list(ctx, filters);
      case REPORT_IDS.TAX:
        return this.tax.list(ctx, filters);
      case REPORT_IDS.COMPLIANCE:
        return this.compliance.list(ctx, filters);
    }
  }

  private async buildExportInput(
    ctx: ReportContext,
    reportId: ReportId,
    filters: CommonReportFilters,
  ): Promise<{ columns: string[]; rows: (string | number | null)[][]; kpis: { label: string; value: string }[] }> {
    const summary = await this.dispatchSummary(ctx, reportId, filters);
    const list = await this.dispatchList(ctx, reportId, filters);
    const kpis = summary.kpis.map((k) => ({ label: k.label, value: k.value }));
    switch (reportId) {
      case REPORT_IDS.DISPATCH:
        return {
          columns: ['Dispatcher', 'Jobs', 'GOA', 'GOA rate', 'Avg call→dispatch (s)', 'Avg on-scene (s)'],
          rows: (list.rows as import('@towcommand/shared').DispatchPerformanceRow[]).map((r) => [
            r.dispatcherName,
            r.jobsTotal,
            r.goaCount,
            `${(r.goaRate * 100).toFixed(1)}%`,
            r.avgCallToDispatchSec ?? '',
            r.avgOnSceneSec ?? '',
          ]),
          kpis,
        };
      case REPORT_IDS.DRIVER:
        return {
          columns: ['Driver', 'Jobs', 'Revenue ($)', 'On-time %', 'Rating', 'GOA rate'],
          rows: (list.rows as import('@towcommand/shared').DriverPerformanceRow[]).map((r) => [
            r.driverName,
            r.jobsCompleted,
            (r.revenueCents / 100).toFixed(2),
            r.onTimePct == null ? '' : `${(r.onTimePct * 100).toFixed(0)}%`,
            r.avgRating ?? '',
            `${(r.goaRate * 100).toFixed(1)}%`,
          ]),
          kpis,
        };
      case REPORT_IDS.REVENUE:
        return {
          columns: ['Label', 'Revenue ($)', 'Invoices'],
          rows: (list.rows as import('@towcommand/shared').RevenueRow[]).map((r) => [
            r.label,
            (r.revenueCents / 100).toFixed(2),
            r.jobs,
          ]),
          kpis,
        };
      case REPORT_IDS.STORAGE:
        return {
          columns: ['Vehicle', 'Job #', 'Days in yard', 'Accrued ($)', 'Invoiced ($)', 'Outstanding ($)'],
          rows: (list.rows as import('@towcommand/shared').StorageRow[]).map((r) => [
            r.vehicleLabel,
            r.jobNumber,
            r.daysInYard,
            (r.accruedFeesCents / 100).toFixed(2),
            (r.invoicedFeesCents / 100).toFixed(2),
            (r.outstandingCents / 100).toFixed(2),
          ]),
          kpis,
        };
      case REPORT_IDS.PNL:
        return {
          columns: ['Dimension', 'Revenue ($)', 'Commission ($)', 'Fuel ($)', 'Depreciation ($)', 'Motor club ($)', 'Net ($)'],
          rows: (list.rows as import('@towcommand/shared').PnlRow[]).map((r) => [
            r.label,
            (r.revenueCents / 100).toFixed(2),
            (r.driverCommissionCents / 100).toFixed(2),
            (r.fuelCostCents / 100).toFixed(2),
            (r.truckDepreciationCents / 100).toFixed(2),
            (r.motorClubFeesCents / 100).toFixed(2),
            (r.netCents / 100).toFixed(2),
          ]),
          kpis,
        };
      case REPORT_IDS.COMMISSION:
        return {
          columns: ['Driver', 'Pay period', 'Jobs', 'Gross ($)', 'Commission ($)', 'Net ($)'],
          rows: (list.rows as import('@towcommand/shared').CommissionLineRow[]).map((r) => [
            r.driverName,
            r.payPeriodKey,
            r.jobsCount,
            (r.grossRevenueCents / 100).toFixed(2),
            (r.commissionBaseCents / 100).toFixed(2),
            (r.netCents / 100).toFixed(2),
          ]),
          kpis,
        };
      case REPORT_IDS.TAX:
        return {
          columns: ['Jurisdiction', 'Tax', 'Taxable ($)', 'Tax collected ($)', 'Exempt ($)', 'Invoices'],
          rows: (list.rows as import('@towcommand/shared').TaxRow[]).map((r) => [
            r.jurisdiction,
            r.taxName,
            (r.taxableSalesCents / 100).toFixed(2),
            (r.taxCollectedCents / 100).toFixed(2),
            (r.exemptSalesCents / 100).toFixed(2),
            r.invoiceCount,
          ]),
          kpis,
        };
      case REPORT_IDS.COMPLIANCE:
        return {
          columns: ['Category', 'Subject', 'Detail', 'Days to breach', 'Severity'],
          rows: (list.rows as import('@towcommand/shared').ComplianceRow[]).map((r) => [
            r.category,
            r.subject,
            r.detail,
            r.daysToBreach ?? '',
            r.severity,
          ]),
          kpis,
        };
    }
  }

  private assertAccess(role: string | null, reportId: ReportId): void {
    if (!role || !canAccessReport(role, reportId)) {
      throw new ForbiddenException(`Role '${role ?? 'unknown'}' cannot view report '${reportId}'`);
    }
  }

  private ctx(req: FastifyRequest): ReportContext & {
    ipAddress: string | null;
    userAgent: string | null;
  } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      role: (c.role as string | null) ?? null,
    };
  }
}

function prettyName(id: ReportId): string {
  switch (id) {
    case 'dispatch':
      return 'Dispatch performance';
    case 'driver':
      return 'Driver performance';
    case 'revenue':
      return 'Revenue';
    case 'storage':
      return 'Storage & impound';
    case 'pnl':
      return 'Profit & loss';
    case 'commission':
      return 'Commission';
    case 'tax':
      return 'Tax';
    case 'compliance':
      return 'Compliance';
  }
}
