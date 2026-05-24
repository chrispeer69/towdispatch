/**
 * /driver-dispatch/* — driver-JWT-gated AI-dispatch surface for the in-truck app.
 *
 *   GET /driver-dispatch/jobs/:jobId/eta — predicted drive-to-scene ETA so the
 *                                          driver can sanity-check an offer
 *                                          before accepting.
 *
 * Read-only (no persist). Mirrors DriverEvController: a dedicated driver
 * controller rather than relaxing the operator RolesGuard — keeps the auth
 * blast radius small. Does NOT touch job-acceptance logic; ETA is display-only.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodParam } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from '../driver-experience/current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from '../driver-experience/driver-auth.guard.js';
import type { DispatchCallerCtx } from './smart-dispatch.service.js';
import { SmartDispatchService } from './smart-dispatch.service.js';

const jobParam = z.object({ jobId: z.string().uuid() }).strict();

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-dispatch')
export class DriverDispatchController {
  constructor(private readonly service: SmartDispatchService) {}

  @Get('jobs/:jobId/eta')
  async eta(
    @ZodParam(jobParam) p: { jobId: string },
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ) {
    return this.service.predictEta(this.ctx(driver, req), p.jobId, false);
  }

  private ctx(driver: DriverAuthContext, req: FastifyRequest): DispatchCallerCtx {
    return {
      tenantId: driver.tenantId,
      userId: driver.driverId,
      requestId: req.requestContext.requestId,
    };
  }
}
