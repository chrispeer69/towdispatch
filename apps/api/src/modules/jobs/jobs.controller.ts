import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CancelJobPayload,
  type CreateJobIntakePayload,
  type IntakeResultDto,
  type JobDto,
  type QuotePreviewPayload,
  ROLES,
  type RateQuote,
  cancelJobSchema,
  createJobIntakeSchema,
  quotePreviewSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JobsService } from './jobs.service.js';

const idSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

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
