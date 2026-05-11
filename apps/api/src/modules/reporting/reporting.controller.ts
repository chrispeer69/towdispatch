/**
 * ReportingController — REST surface for Session 14.
 *
 *   GET    /reporting                          → list of report cards (id + title + description)
 *   GET    /reporting/{reportId}/summary       → KPI tile
 *   GET    /reporting/{reportId}               → full detail (filters via query string)
 *   POST   /reporting/{reportId}/export        → CSV / PDF, returns a signed-ish URL
 *
 *   GET    /reporting/saved                    → list of saved reports
 *   POST   /reporting/saved                    → create a saved report (with optional schedule)
 *   GET    /reporting/saved/{id}               → one saved report
 *   PATCH  /reporting/saved/{id}               → update or attach/detach schedule
 *   DELETE /reporting/saved/{id}               → soft-delete
 *
 * RBAC: each report has its own allowlist (see report-rbac.ts). The base
 * RolesGuard enforces at the route boundary; ReportingService narrows
 * driver-scoped queries to the caller's own driverId.
 */
import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateSavedReportPayload,
  type ExportReportPayload,
  type ExportReportResponse,
  ROLES,
  type ReportDetailDto,
  type ReportFiltersBase,
  type ReportId,
  type ReportSummaryDto,
  type SavedReportDto,
  type UpdateSavedReportPayload,
  createSavedReportSchema,
  exportReportPayloadSchema,
  reportFiltersBaseSchema,
  reportShortDescriptions,
  reportTitles,
  updateSavedReportSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ReportExportService } from './export/report-export.service.js';
import { rolesForReport } from './report-rbac.js';
import { ReportingService } from './reporting.service.js';
import type { AuthCtx } from './reporting.types.js';
import { SavedReportsService } from './scheduling/saved-reports.service.js';

const reportIdParamSchema = z.object({
  reportId: z.enum([
    'dispatch-performance',
    'driver-performance',
    'revenue',
    'storage',
    'pnl',
    'commission',
    'tax',
    'compliance',
  ]),
});

const idSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('reporting')
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly exporter: ReportExportService,
    private readonly saved: SavedReportsService,
  ) {}

  @Get()
  @Roles(
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.DISPATCHER,
    ROLES.ACCOUNTING,
    ROLES.AUDITOR,
    ROLES.DRIVER,
  )
  list(@Req() req: FastifyRequest): {
    reports: Array<{ id: ReportId; title: string; description: string; allowed: boolean }>;
  } {
    const role = (req.requestContext.role as string | null) ?? null;
    const reports = this.reporting.reporterIds().map((id) => ({
      id,
      title: reportTitles[id],
      description: reportShortDescriptions[id],
      allowed: role !== null && rolesForReport(id).includes(role as never),
    }));
    return { reports };
  }

  @Get(':reportId/summary')
  @Roles(
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.DISPATCHER,
    ROLES.ACCOUNTING,
    ROLES.AUDITOR,
    ROLES.DRIVER,
  )
  async summary(
    @ZodParam(reportIdParamSchema) p: { reportId: ReportId },
    @ZodQuery(reportFiltersBaseSchema) filters: ReportFiltersBase,
    @Req() req: FastifyRequest,
  ): Promise<ReportSummaryDto> {
    this.assertCanAccess(req, p.reportId);
    return this.reporting.summary(this.ctx(req), p.reportId, filters);
  }

  @Get(':reportId')
  @Roles(
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.DISPATCHER,
    ROLES.ACCOUNTING,
    ROLES.AUDITOR,
    ROLES.DRIVER,
  )
  async detail(
    @ZodParam(reportIdParamSchema) p: { reportId: ReportId },
    @ZodQuery(reportFiltersBaseSchema) filters: ReportFiltersBase,
    @Req() req: FastifyRequest,
  ): Promise<ReportDetailDto> {
    this.assertCanAccess(req, p.reportId);
    return this.reporting.detail(this.ctx(req), p.reportId, filters);
  }

  @Post(':reportId/export')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async export(
    @ZodParam(reportIdParamSchema) p: { reportId: ReportId },
    @ZodBody(exportReportPayloadSchema) body: ExportReportPayload,
    @Req() req: FastifyRequest,
  ): Promise<ExportReportResponse> {
    this.assertCanAccess(req, p.reportId);
    const ctx = this.ctx(req);
    const filters = reportFiltersBaseSchema.parse(body.filters ?? {});
    const start = Date.now();
    const detail = await this.reporting.detailRaw(ctx, p.reportId, filters);
    const out =
      body.format === 'csv'
        ? await this.exporter.exportCsv(ctx.tenantId, p.reportId, detail, p.reportId)
        : await this.exporter.exportPdf(ctx.tenantId, p.reportId, detail, p.reportId);
    await this.reporting.logRun(
      ctx,
      p.reportId,
      body.format,
      'success',
      detail.totalRows,
      Date.now() - start,
      out.key,
    );
    return { url: out.url, filename: out.filename, expiresAt: out.expiresAt.toISOString() };
  }

  // ====== Saved reports ======

  @Get('saved')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async listSaved(@Req() req: FastifyRequest): Promise<{ data: SavedReportDto[] }> {
    return { data: await this.saved.list(this.ctx(req)) };
  }

  @Post('saved')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async createSaved(
    @ZodBody(createSavedReportSchema) body: CreateSavedReportPayload,
    @Req() req: FastifyRequest,
  ): Promise<SavedReportDto> {
    this.assertCanAccess(req, body.reportId);
    return this.saved.create(this.ctx(req), body);
  }

  @Get('saved/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async getSaved(
    @ZodParam(idSchema) p: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<SavedReportDto> {
    return this.saved.get(this.ctx(req), p.id);
  }

  @Patch('saved/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async updateSaved(
    @ZodParam(idSchema) p: { id: string },
    @ZodBody(updateSavedReportSchema) body: UpdateSavedReportPayload,
    @Req() req: FastifyRequest,
  ): Promise<SavedReportDto> {
    return this.saved.update(this.ctx(req), p.id, body);
  }

  @Delete('saved/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async deleteSaved(
    @ZodParam(idSchema) p: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.saved.remove(this.ctx(req), p.id);
  }

  private ctx(req: FastifyRequest): AuthCtx {
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

  private assertCanAccess(req: FastifyRequest, reportId: ReportId): void {
    const role = (req.requestContext.role as string | null) ?? null;
    if (!role) throw new ForbiddenException('Insufficient role for this report');
    const allowed = rolesForReport(reportId);
    if (!allowed.includes(role as never)) {
      throw new ForbiddenException('Insufficient role for this report');
    }
  }
}
