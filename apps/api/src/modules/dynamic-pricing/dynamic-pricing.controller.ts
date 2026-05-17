/**
 * DynamicPricingController — REST endpoints for the dynamic-pricing
 * surface. RBAC follows the spec:
 *
 *   OWNER, ADMIN     — full control (configure, activate, override, all reports)
 *   MANAGER          — activate/deactivate, override on quotes, view reports
 *   DISPATCHER       — override on quotes only
 *   ACCOUNTING       — read-only on reports
 *   AUDITOR          — read-only on reports
 *   DRIVER           — no API access (badge-only on job card)
 *
 * Read endpoints (list tiers, NOAA mappings, holidays, pulse) are open
 * to all authenticated roles for simplicity; writes are gated.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type ActivateDynamicPricingTierPayload,
  type ApproveDemandSurgeSuggestionPayload,
  type CreateDynamicPricingHolidayPayload,
  type CreateDynamicPricingNoaaMappingPayload,
  type CreateDynamicPricingOverridePayload,
  type CreateDynamicPricingTierPayload,
  type DeactivateDynamicPricingTierPayload,
  type DeclineQuotePayload,
  type DynamicPricingTenantSettings,
  ROLES,
  type SaveStepResponsePayload,
  type UpdateDynamicPricingHolidayPayload,
  type UpdateDynamicPricingNoaaMappingPayload,
  type UpdateDynamicPricingTierPayload,
  activateDynamicPricingTierSchema,
  approveDemandSurgeSuggestionSchema,
  createDynamicPricingHolidaySchema,
  createDynamicPricingNoaaMappingSchema,
  createDynamicPricingOverrideSchema,
  createDynamicPricingTierSchema,
  deactivateDynamicPricingTierSchema,
  declineQuoteSchema,
  dynamicPricingTenantSettingsSchema,
  saveStepResponseSchema,
  updateDynamicPricingHolidaySchema,
  updateDynamicPricingNoaaMappingSchema,
  updateDynamicPricingTierSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DynamicPricingService } from './dynamic-pricing.service.js';
import { PulseAggregatorService } from './pulse-aggregator.service.js';
import { DynamicPricingReportsService } from './reports.service.js';
import { SaveWorkflowService } from './save-workflow.service.js';

const idParam = z.object({ id: z.string().uuid() });
const jobIdParam = z.object({ jobId: z.string().uuid() });
const reportRange = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).optional().default('json'),
});

@UseGuards(RolesGuard)
@Controller('dynamic-pricing')
export class DynamicPricingController {
  constructor(
    private readonly service: DynamicPricingService,
    private readonly pulse: PulseAggregatorService,
    private readonly reports: DynamicPricingReportsService,
    private readonly save: SaveWorkflowService,
  ) {}

  // ---------- tiers ----------

  @Get('tiers')
  async listTiers(@Req() req: FastifyRequest) {
    return this.service.listTiers(this.callerCtx(req));
  }

  @Post('tiers')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async createTier(
    @ZodBody(createDynamicPricingTierSchema) body: CreateDynamicPricingTierPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.createTier(this.callerCtx(req), body);
  }

  @Patch('tiers/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateTier(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(updateDynamicPricingTierSchema) body: UpdateDynamicPricingTierPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateTier(this.callerCtx(req), params.id, body);
  }

  @Delete('tiers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async softDeleteTier(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    await this.service.softDeleteTier(this.callerCtx(req), params.id);
  }

  @Post('tiers/:id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async activateTier(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(activateDynamicPricingTierSchema) body: ActivateDynamicPricingTierPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.activateTier(this.callerCtx(req), params.id, body.reason);
  }

  @Post('tiers/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async deactivateTier(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(deactivateDynamicPricingTierSchema) body: DeactivateDynamicPricingTierPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.deactivateTier(this.callerCtx(req), params.id, body.reason);
  }

  // ---------- NOAA mappings ----------

  @Get('noaa-mappings')
  async listNoaaMappings(@Req() req: FastifyRequest) {
    return this.service.listNoaaMappings(this.callerCtx(req));
  }

  @Post('noaa-mappings')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async createNoaaMapping(
    @ZodBody(createDynamicPricingNoaaMappingSchema) body: CreateDynamicPricingNoaaMappingPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.createNoaaMapping(this.callerCtx(req), body);
  }

  @Patch('noaa-mappings/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateNoaaMapping(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(updateDynamicPricingNoaaMappingSchema) body: UpdateDynamicPricingNoaaMappingPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateNoaaMapping(this.callerCtx(req), params.id, body);
  }

  // ---------- Holidays ----------

  @Get('holidays')
  async listHolidays(@Req() req: FastifyRequest) {
    return this.service.listHolidays(this.callerCtx(req));
  }

  @Post('holidays')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async createHoliday(
    @ZodBody(createDynamicPricingHolidaySchema) body: CreateDynamicPricingHolidayPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.createHoliday(this.callerCtx(req), body);
  }

  @Patch('holidays/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateHoliday(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(updateDynamicPricingHolidaySchema) body: UpdateDynamicPricingHolidayPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateHoliday(this.callerCtx(req), params.id, body);
  }

  // ---------- Tenant settings (cap, surge thresholds, storm flag) ----------

  @Get('settings')
  async getTenantSettings(@Req() req: FastifyRequest) {
    return this.service.getTenantSettings(this.callerCtx(req));
  }

  @Patch('settings')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async patchTenantSettings(
    @ZodBody(dynamicPricingTenantSettingsSchema.partial())
    body: Partial<DynamicPricingTenantSettings>,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateTenantSettings(this.callerCtx(req), body);
  }

  // ---------- Pulse ----------

  @Get('pulse/today')
  async pulseToday(@Req() req: FastifyRequest) {
    return this.pulse.getToday(this.callerCtx(req));
  }

  // ---------- Demand surge suggestions ----------

  @Get('demand-surge/suggestions')
  async listDemandSurge(@Req() req: FastifyRequest) {
    return this.service.listPendingDemandSurgeSuggestions(this.callerCtx(req));
  }

  @Post('demand-surge/suggestions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async approveDemandSurge(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(approveDemandSurgeSuggestionSchema) body: ApproveDemandSurgeSuggestionPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.approveDemandSurgeSuggestion(
      this.callerCtx(req),
      params.id,
      body.tierName,
      body.autoRevertHours,
    );
  }

  @Post('demand-surge/suggestions/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async dismissDemandSurge(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    await this.service.dismissDemandSurgeSuggestion(this.callerCtx(req), params.id);
  }

  // ---------- Override on a job/quote ----------

  @Post('overrides/:jobId')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async createOverride(
    @ZodParam(jobIdParam) params: { jobId: string },
    @ZodBody(createDynamicPricingOverrideSchema) body: CreateDynamicPricingOverridePayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.createOverride(this.callerCtx(req), params.jobId, body);
  }

  // ---------- Quote save workflow ----------

  @Post('quotes/:jobId/decline')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async declineQuote(
    @ZodParam(jobIdParam) params: { jobId: string },
    @ZodBody(declineQuoteSchema) body: DeclineQuotePayload,
    @Req() req: FastifyRequest,
  ) {
    return this.save.declineAndOpenStep1(this.callerCtx(req), params.jobId, body);
  }

  @Post('quotes/:jobId/save-step')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async respondSaveStep(
    @ZodParam(jobIdParam) params: { jobId: string },
    @ZodBody(saveStepResponseSchema) body: SaveStepResponsePayload,
    @Req() req: FastifyRequest,
  ) {
    return this.save.respondToCurrentStep(this.callerCtx(req), params.jobId, body);
  }

  @Get('quotes/:jobId/save-trail')
  async listSaveTrail(@ZodParam(jobIdParam) params: { jobId: string }, @Req() req: FastifyRequest) {
    return this.save.listForJob(this.callerCtx(req), params.jobId);
  }

  // ---------- Reports ----------

  @Get('reports/tier-history')
  async tierHistoryReport(
    @ZodQuery(reportRange) q: { from?: string; to?: string; format: 'json' | 'csv' | 'xlsx' },
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const range = parseRange(q);
    const rows = await this.reports.tierHistory(this.callerCtx(req), range);
    return sendReport(res, 'tier-history', rows, q.format, this.reports);
  }

  @Get('reports/tier-performance')
  async tierPerformanceReport(
    @ZodQuery(reportRange) q: { from?: string; to?: string; format: 'json' | 'csv' | 'xlsx' },
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const range = parseRange(q);
    const rows = await this.reports.tierPerformance(this.callerCtx(req), range);
    return sendReport(res, 'tier-performance', rows, q.format, this.reports);
  }

  @Get('reports/overrides')
  async overrideReport(
    @ZodQuery(reportRange) q: { from?: string; to?: string; format: 'json' | 'csv' | 'xlsx' },
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const range = parseRange(q);
    const rows = await this.reports.overrideReport(this.callerCtx(req), range);
    return sendReport(res, 'override-report', rows, q.format, this.reports);
  }

  @Get('reports/year-over-year')
  async yearOverYear(@Req() req: FastifyRequest) {
    return this.reports.yearOverYearGate(this.callerCtx(req));
  }

  private callerCtx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}

function parseRange(q: { from?: string; to?: string }): { from?: Date; to?: Date } {
  const r: { from?: Date; to?: Date } = {};
  if (q.from) r.from = new Date(q.from);
  if (q.to) r.to = new Date(q.to);
  return r;
}

async function sendReport<T extends Record<string, unknown>>(
  res: FastifyReply,
  filenameStem: string,
  rows: T[],
  format: 'json' | 'csv' | 'xlsx',
  reports: DynamicPricingReportsService,
): Promise<void> {
  if (format === 'csv') {
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="${filenameStem}.csv"`);
    res.send(reports.toCsv(rows));
    return;
  }
  if (format === 'xlsx') {
    const buf = await reports.toXlsx(filenameStem, rows);
    res.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('content-disposition', `attachment; filename="${filenameStem}.xlsx"`);
    res.send(buf);
    return;
  }
  res.send(rows);
}
