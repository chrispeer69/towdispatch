/**
 * /reporting/kpi/* — the tenant KPI dashboard surface (Session 53).
 *
 * Gated by REPORTING_BUILDER_ENABLED (same flag as the builder). Layouts are
 * per-user (the default per-tenant); widget values are computed on demand in
 * the caller's RLS-bound transaction.
 *
 *   GET /reporting/kpi/widgets        → widget catalog
 *   GET /reporting/kpi/widgets/:id    → computed value (config via query)
 *   GET /reporting/kpi/layouts/me     → caller's layout (or generated default)
 *   PUT /reporting/kpi/layouts/me     → save caller's layout
 */
import { Controller, Get, Put, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import {
  ERROR_CODES,
  type KpiLayoutDto,
  type KpiValueDto,
  type KpiWidgetCatalogDto,
  type KpiWidgetId,
  type PutKpiLayoutPayload,
  ROLES,
  kpiWidgetIdValues,
  putKpiLayoutSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { ConfigService } from '../../../config/config.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { KpiService } from './kpi.service.js';

const widgetParamSchema = z.object({ id: z.enum(kpiWidgetIdValues) });
const widgetQuerySchema = z.object({ compare_to: z.string().max(40).optional() });

@UseGuards(RolesGuard)
@Controller('reporting/kpi')
export class KpiController {
  constructor(
    private readonly kpi: KpiService,
    private readonly config: ConfigService,
  ) {}

  @Get('widgets')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async widgets(@Req() req: FastifyRequest): Promise<{ data: KpiWidgetCatalogDto[] }> {
    this.assertEnabled();
    return { data: await this.kpi.catalog(this.ctx(req)) };
  }

  @Get('widgets/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async widget(
    @ZodParam(widgetParamSchema) p: { id: KpiWidgetId },
    @ZodQuery(widgetQuerySchema) q: { compare_to?: string },
    @Req() req: FastifyRequest,
  ): Promise<KpiValueDto> {
    this.assertEnabled();
    const config = q.compare_to ? { compare_to: q.compare_to } : {};
    return this.kpi.compute(this.ctx(req), p.id, config);
  }

  @Get('layouts/me')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async getLayout(@Req() req: FastifyRequest): Promise<KpiLayoutDto> {
    this.assertEnabled();
    return this.kpi.getLayout(this.ctx(req));
  }

  @Put('layouts/me')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async putLayout(
    @ZodBody(putKpiLayoutSchema) body: PutKpiLayoutPayload,
    @Req() req: FastifyRequest,
  ): Promise<KpiLayoutDto> {
    this.assertEnabled();
    return this.kpi.putLayout(this.ctx(req), body.layout);
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
