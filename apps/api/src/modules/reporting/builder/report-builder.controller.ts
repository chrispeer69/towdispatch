/**
 * /reporting/builder/* — the custom report builder surface (Session 53).
 *
 * Additive to the Session 14 ReportingController (the canned-reporter lane).
 * Gated by REPORTING_BUILDER_ENABLED — 503 when off. Field exposure is bounded
 * by the entity registry; there is no raw-SQL path.
 *
 *   GET    /reporting/builder/registry                  → queryable entities + fields
 *   GET    /reporting/builder/templates                 → my + tenant-shared templates
 *   POST   /reporting/builder/templates                 → create
 *   GET    /reporting/builder/templates/:id             → one
 *   PATCH  /reporting/builder/templates/:id             → update
 *   DELETE /reporting/builder/templates/:id             → soft-delete
 *   POST   /reporting/builder/preview                   → ad-hoc run (not saved)
 *   POST   /reporting/builder/templates/:id/run         → run saved template (rows)
 *   POST   /reporting/builder/templates/:id/run-now     → render a file + log a run
 *   PUT    /reporting/builder/templates/:id/schedule    → attach/replace schedule
 *   DELETE /reporting/builder/templates/:id/schedule    → detach schedule
 *   GET    /reporting/builder/runs?templateId=          → recent runs
 *   GET    /reporting/builder/runs/:id                  → one run (signed link)
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ERROR_CODES,
  type EntityMeta,
  type ExecuteReportResult,
  ROLES,
  type ReportPreviewPayload,
  type ReportRunNowPayload,
  type ReportTemplateBody,
  type ReportTemplateDto,
  type ReportTemplateRunDto,
  type ReportTemplateScheduleBody,
  type UpdateReportTemplatePayload,
  reportPreviewSchema,
  reportRunNowSchema,
  reportTemplateBodySchema,
  reportTemplateScheduleBodySchema,
  updateReportTemplateSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { ConfigService } from '../../../config/config.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { registryForWire } from './entity-registry.js';
import { ReportBuilderService } from './report-builder.service.js';

const idSchema = z.object({ id: z.string().uuid() });
const runsQuerySchema = z.object({ templateId: z.string().uuid().optional() });

@UseGuards(RolesGuard)
@Controller('reporting/builder')
export class ReportBuilderController {
  constructor(
    private readonly builder: ReportBuilderService,
    private readonly config: ConfigService,
  ) {}

  @Get('registry')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  registry(): { entities: EntityMeta[] } {
    this.assertEnabled();
    return { entities: registryForWire() as EntityMeta[] };
  }

  @Get('templates')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async list(@Req() req: FastifyRequest): Promise<{ data: ReportTemplateDto[] }> {
    this.assertEnabled();
    return { data: await this.builder.listTemplates(this.ctx(req)) };
  }

  @Post('templates')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async create(
    @ZodBody(reportTemplateBodySchema) body: ReportTemplateBody,
    @Req() req: FastifyRequest,
  ): Promise<ReportTemplateDto> {
    this.assertEnabled();
    return this.builder.createTemplate(this.ctx(req), body);
  }

  @Get('templates/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async get(
    @ZodParam(idSchema) p: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<ReportTemplateDto> {
    this.assertEnabled();
    return this.builder.getTemplate(this.ctx(req), p.id);
  }

  @Patch('templates/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async update(
    @ZodParam(idSchema) p: { id: string },
    @ZodBody(updateReportTemplateSchema) body: UpdateReportTemplatePayload,
    @Req() req: FastifyRequest,
  ): Promise<ReportTemplateDto> {
    this.assertEnabled();
    return this.builder.updateTemplate(this.ctx(req), p.id, body);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async remove(@ZodParam(idSchema) p: { id: string }, @Req() req: FastifyRequest): Promise<void> {
    this.assertEnabled();
    await this.builder.removeTemplate(this.ctx(req), p.id);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async preview(
    @ZodBody(reportPreviewSchema) body: ReportPreviewPayload,
    @Req() req: FastifyRequest,
  ): Promise<ExecuteReportResult> {
    this.assertEnabled();
    return this.builder.preview(this.ctx(req), body);
  }

  @Post('templates/:id/run')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async run(
    @ZodParam(idSchema) p: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<ExecuteReportResult> {
    this.assertEnabled();
    return this.builder.execute(this.ctx(req), p.id);
  }

  @Post('templates/:id/run-now')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async runNow(
    @ZodParam(idSchema) p: { id: string },
    @ZodBody(reportRunNowSchema) body: ReportRunNowPayload,
    @Req() req: FastifyRequest,
  ): Promise<ReportTemplateRunDto> {
    this.assertEnabled();
    return this.builder.runNow(this.ctx(req), p.id, body.format);
  }

  @Put('templates/:id/schedule')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async putSchedule(
    @ZodParam(idSchema) p: { id: string },
    @ZodBody(reportTemplateScheduleBodySchema) body: ReportTemplateScheduleBody,
    @Req() req: FastifyRequest,
  ): Promise<ReportTemplateDto> {
    this.assertEnabled();
    return this.builder.putSchedule(this.ctx(req), p.id, body);
  }

  @Delete('templates/:id/schedule')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async removeSchedule(
    @ZodParam(idSchema) p: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    this.assertEnabled();
    await this.builder.removeSchedule(this.ctx(req), p.id);
  }

  @Get('runs')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async listRuns(
    @ZodQuery(runsQuerySchema) q: { templateId?: string },
    @Req() req: FastifyRequest,
  ): Promise<{ data: ReportTemplateRunDto[] }> {
    this.assertEnabled();
    return { data: await this.builder.listRuns(this.ctx(req), q.templateId) };
  }

  @Get('runs/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async getRun(
    @ZodParam(idSchema) p: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<ReportTemplateRunDto> {
    this.assertEnabled();
    return this.builder.getRun(this.ctx(req), p.id);
  }

  private assertEnabled(): void {
    if (!this.config.reportingBuilderEnabled) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Reporting builder is disabled',
      });
    }
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
}
