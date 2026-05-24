/**
 * FraudDetectionController — operator-side REST surface for Fraud Detection.
 *
 * RBAC mirrors the reporting / lien modules:
 *   OWNER, ADMIN, DISPATCHER            — full control (score / review / disputes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — read access (queue / detail / stats)
 *   MANAGER, ACCOUNTING, DRIVER         — no access
 *
 * Money is cents-as-integer; timestamps are UTC ISO-8601 over the wire. This
 * module is ADVISORY ONLY — POST /jobs/:id/score computes + returns a risk
 * assessment (the optional pre-submit hook) but never blocks invoicing.
 */
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  type ListDisputesFilter,
  type ListHighRiskFilter,
  ROLES,
  type RecordDisputePayload,
  type RecordFraudOutcomePayload,
  type ResolveDisputePayload,
  type ReviewFraudScorePayload,
  listDisputesFilterSchema,
  listHighRiskFilterSchema,
  recordDisputeSchema,
  recordFraudOutcomeSchema,
  resolveDisputeSchema,
  reviewFraudScoreSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { FraudDetectionService } from './fraud-detection.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const jobParam = z.object({ id: z.string().uuid() });
const disputeParam = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('fraud-detection')
export class FraudDetectionController {
  constructor(private readonly service: FraudDetectionService) {}

  // ----- Risk queue + per-job detail -----

  @Get('high-risk')
  @Roles(...READERS)
  async highRisk(
    @Req() req: FastifyRequest,
    @ZodQuery(listHighRiskFilterSchema) query: ListHighRiskFilter,
  ) {
    return this.service.listHighRisk(this.ctx(req), query);
  }

  @Get('jobs/:id')
  @Roles(...READERS)
  async jobRisk(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { id: string }) {
    return this.service.getJobRisk(this.ctx(req), p.id);
  }

  /** Score (or re-score) a job. Doubles as the optional pre-submit hook. */
  @Post('jobs/:id/score')
  @Roles(...WRITERS)
  async score(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { id: string }) {
    return this.service.scoreJob(this.ctx(req), p.id);
  }

  @Post('jobs/:id/review')
  @Roles(...WRITERS)
  async review(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { id: string },
    @ZodBody(reviewFraudScoreSchema) body: ReviewFraudScorePayload,
  ) {
    return this.service.reviewScore(this.ctx(req), p.id, body);
  }

  // ----- Dispute log -----

  @Get('disputes')
  @Roles(...READERS)
  async listDisputes(
    @Req() req: FastifyRequest,
    @ZodQuery(listDisputesFilterSchema) query: ListDisputesFilter,
  ) {
    return this.service.listDisputes(this.ctx(req), query);
  }

  @Post('disputes')
  @Roles(...WRITERS)
  async recordDispute(
    @Req() req: FastifyRequest,
    @ZodBody(recordDisputeSchema) body: RecordDisputePayload,
  ) {
    return this.service.recordDispute(this.ctx(req), body);
  }

  @Post('disputes/:id/resolve')
  @Roles(...WRITERS)
  async resolveDispute(
    @Req() req: FastifyRequest,
    @ZodParam(disputeParam) p: { id: string },
    @ZodBody(resolveDisputeSchema) body: ResolveDisputePayload,
  ) {
    return this.service.resolveDispute(this.ctx(req), p.id, body);
  }

  @Post('disputes/:id/outcome')
  @Roles(...WRITERS)
  async recordOutcome(
    @Req() req: FastifyRequest,
    @ZodParam(disputeParam) p: { id: string },
    @ZodBody(recordFraudOutcomeSchema) body: RecordFraudOutcomePayload,
  ) {
    return this.service.recordOutcome(this.ctx(req), p.id, body);
  }

  // ----- Reports -----

  @Get('reports/dispute-stats')
  @Roles(...READERS)
  async disputeStats(
    @Req() req: FastifyRequest,
    @ZodQuery(z.object({ days: z.coerce.number().int().min(1).max(365).optional() }))
    query: { days?: number },
  ) {
    return this.service.disputeStats(this.ctx(req), query.days ?? 90);
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
