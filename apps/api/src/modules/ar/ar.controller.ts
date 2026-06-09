/**
 * ArController — the Build 5 REST surface. Owns:
 *
 *   /ar/search                        A/R search workspace
 *   /ar/reports/:reportId             run a report (json | xlsx | pdf)
 *   /ar/statements/preview            statement preview JSON
 *   /ar/statements/pdf                statement PDF (download only)
 *   /ar/statements/send               render + email + audit
 *   /ar/statements/recent             recent statement sends
 *   /ar/red-alert/recent              recent Monday alert sends
 *   /ar/red-alert/run-now             on-demand fire (owner/admin only)
 *   /ar/invoice-defaults              GET + PATCH tenant invoice defaults
 *
 * The driver_commissions report is gated to Owner+Admin per the
 * driver visibility wall locked in Build 3/4.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { tenants } from '@ustowdispatch/db';
import {
  type ArReportFilters,
  type ArReportId,
  type ArReportResponse,
  type ArSearchFilters,
  type ArSearchResponse,
  ERROR_CODES,
  ROLES,
  type RedAlertSendDto,
  type StatementPreviewPayload,
  type StatementPreviewResponse,
  type StatementSendDto,
  type StatementSendPayload,
  type TenantInvoiceDefaults,
  type UpdateTenantInvoiceDefaultsPayload,
  arReportFiltersSchema,
  arReportIdValues,
  arSearchFiltersSchema,
  statementPreviewSchema,
  statementSendPayloadSchema,
  updateTenantInvoiceDefaultsSchema,
} from '@ustowdispatch/shared';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { ArExportService } from './ar-export.service.js';
import { ArReportsService } from './ar-reports.service.js';
import { ArSearchService } from './ar-search.service.js';
import { RedAlertService } from './red-alert.service.js';
import { StatementsService } from './statements.service.js';
import { mergeInvoiceDefaults, readInvoiceDefaults } from './tenant-settings.helper.js';

const reportIdParamSchema = z.object({
  reportId: z.enum(arReportIdValues),
});

const READ_ROLES = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.ACCOUNTING,
  ROLES.DISPATCHER,
  ROLES.AUDITOR,
] as const;
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING] as const;
const ADMIN_ONLY = [ROLES.OWNER, ROLES.ADMIN] as const;

@UseGuards(RolesGuard)
@Controller('ar')
export class ArController {
  constructor(
    private readonly arSearch: ArSearchService,
    private readonly reports: ArReportsService,
    private readonly exporter: ArExportService,
    private readonly statements: StatementsService,
    private readonly redAlert: RedAlertService,
    private readonly db: TenantAwareDb,
  ) {}

  // ---------- A/R Search ----------

  @Get('search')
  @Roles(...READ_ROLES)
  async searchRoute(
    @ZodQuery(arSearchFiltersSchema) filters: ArSearchFilters,
    @Req() req: FastifyRequest,
  ): Promise<ArSearchResponse> {
    return this.arSearch.search(this.ctx(req), filters);
  }

  // ---------- Reports ----------

  @Get('reports/:reportId')
  @Roles(...READ_ROLES)
  async runReport(
    @ZodParam(reportIdParamSchema) params: { reportId: ArReportId },
    @ZodQuery(arReportFiltersSchema) filters: ArReportFilters,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ctx = this.ctx(req);

    // Driver commissions = admin-only per the driver visibility wall.
    if (params.reportId === 'driver_commissions') {
      const role = ctx.role;
      if (role !== 'owner' && role !== 'admin') {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Driver commission earnings is restricted to owner + admin roles.',
        });
      }
    }

    const result = await this.reports.run(ctx, params.reportId, filters);

    if (filters.format === 'json') {
      reply.send(result as unknown as ArReportResponse);
      return;
    }

    const tenantName = await this.loadTenantName(ctx);
    const filename = `${params.reportId}-${result.generatedAt.slice(0, 10)}`;
    if (filters.format === 'xlsx') {
      const buf = await this.exporter.renderXlsx(result, tenantName);
      reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${filename}.xlsx"`)
        .send(buf);
      return;
    }
    if (filters.format === 'pdf') {
      const buf = await this.exporter.renderPdf(result, tenantName);
      reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}.pdf"`)
        .send(buf);
      return;
    }
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `Unknown format: ${filters.format}`,
    });
  }

  // ---------- Statements ----------

  @Post('statements/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(...READ_ROLES)
  async statementPreview(
    @ZodBody(statementPreviewSchema) body: StatementPreviewPayload,
    @Req() req: FastifyRequest,
  ): Promise<StatementPreviewResponse> {
    return this.statements.preview(this.ctx(req), body);
  }

  @Post('statements/pdf')
  @HttpCode(HttpStatus.OK)
  @Roles(...READ_ROLES)
  async statementPdf(
    @ZodBody(statementPreviewSchema) body: StatementPreviewPayload,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const buf = await this.statements.renderPdf(this.ctx(req), body);
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="statement-${body.accountId}.pdf"`)
      .send(buf);
  }

  @Post('statements/send')
  @Roles(...WRITE_ROLES)
  async statementSend(
    @ZodBody(statementSendPayloadSchema) body: StatementSendPayload,
    @Req() req: FastifyRequest,
  ): Promise<StatementSendDto> {
    return this.statements.send(this.ctx(req), body);
  }

  @Get('statements/recent')
  @Roles(...READ_ROLES)
  async statementsRecent(@Req() req: FastifyRequest): Promise<StatementSendDto[]> {
    return this.statements.listRecent(this.ctx(req), 50);
  }

  // ---------- RED ALERT ----------

  @Get('red-alert/recent')
  @Roles(...READ_ROLES)
  async redAlertRecent(@Req() req: FastifyRequest): Promise<RedAlertSendDto[]> {
    return this.redAlert.listRecent(this.ctx(req), 12);
  }

  @Post('red-alert/run-now')
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMIN_ONLY)
  async redAlertRunNow(@Req() req: FastifyRequest): Promise<RedAlertSendDto> {
    return this.redAlert.sendNowForTenant(this.ctx(req));
  }

  // ---------- Tenant Invoice Defaults ----------

  @Get('invoice-defaults')
  @Roles(...READ_ROLES)
  async invoiceDefaultsGet(@Req() req: FastifyRequest): Promise<TenantInvoiceDefaults> {
    const ctx = this.ctx(req);
    const settings = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      return (t?.settings as Record<string, unknown> | null) ?? {};
    });
    return readInvoiceDefaults(settings);
  }

  @Patch('invoice-defaults')
  @Roles(...ADMIN_ONLY)
  async invoiceDefaultsPatch(
    @ZodBody(updateTenantInvoiceDefaultsSchema) body: UpdateTenantInvoiceDefaultsPayload,
    @Req() req: FastifyRequest,
  ): Promise<TenantInvoiceDefaults> {
    const ctx = this.ctx(req);
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      const existing = (t?.settings as Record<string, unknown> | null) ?? {};
      const merged = mergeInvoiceDefaults(existing, body);
      await tx
        .update(tenants)
        .set({ settings: merged, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
      return readInvoiceDefaults(merged);
    });
  }

  // ---------- helpers ----------

  private async loadTenantName(ctx: ReturnType<typeof this.ctx>): Promise<string> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      return t?.name ?? 'US Tow Dispatch';
    });
  }

  private ctx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
    role: string | null;
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

  private toTenantCtx(ctx: ReturnType<typeof this.ctx>): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}
