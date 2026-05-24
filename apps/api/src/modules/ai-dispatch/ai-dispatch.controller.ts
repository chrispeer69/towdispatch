/**
 * AiDispatchController — operator-side REST surface for AI Smart Dispatch.
 *
 * ADVISORY ONLY — nothing here assigns a job. RBAC mirrors the ev-recovery /
 * impound / lien modules:
 *   OWNER, ADMIN, DISPATCHER            — writes (recompute, log prediction, outcome)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — reads (recommendations, ETA, reports)
 *
 * GET /jobs/:jobId/eta is read-only (the dispatch board / panel poll it);
 * POST /jobs/:jobId/eta persists the prediction for the feedback loop.
 */
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ROLES,
  type RecordOutcomePayload,
  recommendQuerySchema,
  recordOutcomeSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { DispatchCallerCtx } from './smart-dispatch.service.js';
import { SmartDispatchService } from './smart-dispatch.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const jobParam = z.object({ jobId: z.string().uuid() });
const windowQuery = z.object({ windowDays: z.coerce.number().int().min(1).max(365).optional() });
const DEFAULT_REPORT_WINDOW_DAYS = 30;

@UseGuards(RolesGuard)
@Controller('ai-dispatch')
export class AiDispatchController {
  constructor(private readonly service: SmartDispatchService) {}

  // ---- recommendations ------------------------------------------------

  @Get('jobs/:jobId/recommendations')
  @Roles(...READERS)
  async latest(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { jobId: string }) {
    return this.service.getLatestRecommendation(this.ctx(req), p.jobId);
  }

  @Post('jobs/:jobId/recommendations')
  @Roles(...WRITERS)
  async recompute(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodQuery(recommendQuerySchema) q: { limit?: number },
  ) {
    return this.service.recommendForJob(this.ctx(req), p.jobId, q.limit);
  }

  // ---- predictive ETA -------------------------------------------------

  @Get('jobs/:jobId/eta')
  @Roles(...READERS)
  async eta(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { jobId: string }) {
    return this.service.predictEta(this.ctx(req), p.jobId, false);
  }

  @Post('jobs/:jobId/eta')
  @Roles(...WRITERS)
  async logEta(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { jobId: string }) {
    return this.service.predictEta(this.ctx(req), p.jobId, true);
  }

  // ---- feedback loop --------------------------------------------------

  @Post('jobs/:jobId/outcome')
  @Roles(...WRITERS)
  async outcome(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(recordOutcomeSchema) body: RecordOutcomePayload,
  ) {
    return this.service.recordOutcome(this.ctx(req), p.jobId, body);
  }

  // ---- accuracy reports ----------------------------------------------

  @Get('reports/recommendation-accuracy')
  @Roles(...READERS)
  async recAccuracy(@Req() req: FastifyRequest, @ZodQuery(windowQuery) q: { windowDays?: number }) {
    return this.service.recommendationAccuracy(
      this.ctx(req),
      q.windowDays ?? DEFAULT_REPORT_WINDOW_DAYS,
    );
  }

  @Get('reports/eta-accuracy')
  @Roles(...READERS)
  async etaAccuracy(@Req() req: FastifyRequest, @ZodQuery(windowQuery) q: { windowDays?: number }) {
    return this.service.etaAccuracy(this.ctx(req), q.windowDays ?? DEFAULT_REPORT_WINDOW_DAYS);
  }

  @Get('reports/driver-performance')
  @Roles(...READERS)
  async driverPerf(@Req() req: FastifyRequest, @ZodQuery(windowQuery) q: { windowDays?: number }) {
    return this.service.driverPerformance(
      this.ctx(req),
      q.windowDays ?? DEFAULT_REPORT_WINDOW_DAYS,
    );
  }

  private ctx(req: FastifyRequest): DispatchCallerCtx {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
