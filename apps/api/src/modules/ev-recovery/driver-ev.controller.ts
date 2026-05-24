/**
 * /driver-ev/* — driver-JWT-gated EV surface for the in-truck app.
 *
 *   GET   /driver-ev/jobs/:jobId                 — EV detail (equipment +
 *                                                  OEM procedure pre-load on accept)
 *   PATCH /driver-ev/jobs/:jobId                 — on-scene intake (SOC, HV, tow mode)
 *   POST  /driver-ev/jobs/:jobId/thermal-events  — 3-tap thermal quick-report
 *
 * Mirrors DriverJobsController (Session 3): a dedicated driver controller
 * rather than relaxing the operator RolesGuard — keeps the auth blast radius
 * small. Driver-originated writes set created_by NULL (a driverId is not a
 * users.id); the audit actor is the driverId via app.current_user_id.
 */
import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  type RecordEvIntakePayload,
  type ReportThermalEventPayload,
  recordEvIntakeSchema,
  reportThermalEventSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from '../driver-experience/current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from '../driver-experience/driver-auth.guard.js';
import type { EvCallerCtx } from './ev-recovery.service.js';
import { EvRecoveryService } from './ev-recovery.service.js';

const jobParam = z.object({ jobId: z.string().uuid() }).strict();

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-ev')
export class DriverEvController {
  constructor(private readonly service: EvRecoveryService) {}

  @Get('jobs/:jobId')
  async detail(
    @ZodParam(jobParam) p: { jobId: string },
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ) {
    return this.service.getJobDetail(this.ctx(driver, req), p.jobId);
  }

  @Patch('jobs/:jobId')
  async intake(
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(recordEvIntakeSchema) body: RecordEvIntakePayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ) {
    return this.service.recordIntake(this.ctx(driver, req), p.jobId, body);
  }

  @Post('jobs/:jobId/thermal-events')
  async thermalEvent(
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(reportThermalEventSchema) body: ReportThermalEventPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ) {
    return this.service.reportThermalEvent(this.ctx(driver, req), p.jobId, body);
  }

  private ctx(driver: DriverAuthContext, req: FastifyRequest): EvCallerCtx {
    return {
      tenantId: driver.tenantId,
      userId: driver.driverId,
      requestId: req.requestContext.requestId,
      createdBy: null,
    };
  }
}
