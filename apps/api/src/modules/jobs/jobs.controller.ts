import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CancelJobPayload,
  type CreateJobIntakePayload,
  type IntakeResultDto,
  type JobDto,
  type JobListFilters,
  type PaginatedJobs,
  type QuotePreviewPayload,
  ROLES,
  type RateQuote,
  cancelJobSchema,
  createJobIntakeSchema,
  jobListFiltersSchema,
  quotePreviewSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JobsService } from './jobs.service.js';

const idSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /**
   * Paginated list for the /jobs index page. Read-only roles can view —
   * accounting/managers need this to audit work. Sorted by createdAt DESC;
   * pagination is offset-based (v1 size: ≤200/page).
   */
  @Get()
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async list(
    @ZodQuery(jobListFiltersSchema) query: JobListFilters,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedJobs> {
    return this.jobs.list(this.callerCtx(req), query);
  }

  /**
   * Live rate-quote preview used by the call-intake screen. Anyone with
   * dispatch privileges can hit this — it never persists anything.
   */
  @Post('quote-preview')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async quotePreview(
    @ZodBody(quotePreviewSchema) body: QuotePreviewPayload,
    @Req() req: FastifyRequest,
  ): Promise<RateQuote> {
    return this.jobs.quotePreview(this.callerCtx(req), body);
  }

  @Post('intake')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async intake(
    @ZodBody(createJobIntakeSchema) body: CreateJobIntakePayload,
    @Req() req: FastifyRequest,
  ): Promise<IntakeResultDto> {
    return this.jobs.createIntake(this.callerCtx(req), body);
  }

  @Get(':id')
  async get(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<JobDto> {
    return this.jobs.get(this.callerCtx(req), params.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async cancel(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(cancelJobSchema) body: CancelJobPayload,
    @Req() req: FastifyRequest,
  ): Promise<JobDto> {
    return this.jobs.cancel(this.callerCtx(req), params.id, body.reason);
  }

  private callerCtx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
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
    };
  }
}
