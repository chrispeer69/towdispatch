/**
 * EvRecoveryController — operator-side REST surface for EV Recovery.
 *
 * RBAC mirrors the impound / lien modules:
 *   OWNER, ADMIN, DISPATCHER            — full control (writes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — read access (detail / OEM lookup)
 *   MANAGER, ACCOUNTING                 — no access
 *   DRIVER                              — uses the separate /driver-ev surface
 *
 * Routes are keyed by jobId (the dispatched job). Money is cents-as-integer;
 * timestamps are UTC ISO-8601 over the wire.
 */
import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  type LogChargeStopPayload,
  type MarkJobEvPayload,
  ROLES,
  type RecordEvIntakePayload,
  type ReportThermalEventPayload,
  logChargeStopSchema,
  markJobEvSchema,
  oemProcedureLookupSchema,
  recordEvIntakeSchema,
  reportThermalEventSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { EvCallerCtx } from './ev-recovery.service.js';
import { EvRecoveryService } from './ev-recovery.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const jobParam = z.object({ jobId: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('ev-recovery')
export class EvRecoveryController {
  constructor(private readonly service: EvRecoveryService) {}

  // Static OEM routes registered before the parametric jobs/:jobId routes.
  @Get('oem-procedures')
  @Roles(...READERS)
  async listOem(@Req() req: FastifyRequest) {
    return this.service.listOemProcedures(this.ctx(req));
  }

  @Get('oem-procedures/lookup')
  @Roles(...READERS)
  async lookupOem(
    @Req() req: FastifyRequest,
    @ZodQuery(oemProcedureLookupSchema) q: { make: string; model?: string; year?: number },
  ) {
    return this.service.lookupOemProcedure(this.ctx(req), q.make, q.model, q.year);
  }

  @Get('jobs/:jobId')
  @Roles(...READERS)
  async detail(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { jobId: string }) {
    return this.service.getJobDetail(this.ctx(req), p.jobId);
  }

  @Post('jobs/:jobId')
  @Roles(...WRITERS)
  async markEv(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(markJobEvSchema) body: MarkJobEvPayload,
  ) {
    return this.service.markJobEv(this.ctx(req), p.jobId, body);
  }

  @Patch('jobs/:jobId')
  @Roles(...WRITERS)
  async intake(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(recordEvIntakeSchema) body: RecordEvIntakePayload,
  ) {
    return this.service.recordIntake(this.ctx(req), p.jobId, body);
  }

  @Post('jobs/:jobId/thermal-events')
  @Roles(...WRITERS)
  async thermalEvent(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(reportThermalEventSchema) body: ReportThermalEventPayload,
  ) {
    return this.service.reportThermalEvent(this.ctx(req), p.jobId, body);
  }

  @Post('jobs/:jobId/charge-stops')
  @Roles(...WRITERS)
  async chargeStop(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(logChargeStopSchema) body: LogChargeStopPayload,
  ) {
    return this.service.logChargeStop(this.ctx(req), p.jobId, body);
  }

  private ctx(req: FastifyRequest): EvCallerCtx {
    const c = req.requestContext;
    const userId = c.userId as string;
    return {
      tenantId: c.tenantId as string,
      userId,
      requestId: c.requestId,
      createdBy: userId,
    };
  }
}
