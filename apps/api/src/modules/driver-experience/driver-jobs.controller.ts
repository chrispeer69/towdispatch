/**
 * /driver-jobs/* — driver-JWT-gated read surface for the in-truck app.
 *
 * Two endpoints:
 *   GET /driver-jobs/me   — active (non-terminal) jobs for the caller
 *   GET /driver-jobs/:id  — single job, must be assigned to caller
 *
 * Added in Session 3 because the operator-side /jobs surface is
 * RolesGuard-gated and rejects driver JWTs. Bridging the two auth
 * surfaces by relaxing the operator guard would be a security
 * regression; a dedicated driver controller keeps blast radius small.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { JobDto } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodParam } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverJobsService } from './driver-jobs.service.js';

const idSchema = z.object({ id: z.string().uuid() }).strict();

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-jobs')
export class DriverJobsController {
  constructor(private readonly jobs: DriverJobsService) {}

  @Get('me')
  async myActive(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<JobDto[]> {
    return this.jobs.listMyActive(this.driverCtx(driver, req));
  }

  @Get(':id')
  async getMine(
    @ZodParam(idSchema) params: { id: string },
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<JobDto> {
    return this.jobs.getMyJob(this.driverCtx(driver, req), params.id);
  }

  private driverCtx(driver: DriverAuthContext, req: FastifyRequest): DriverContext {
    const c = req.requestContext;
    return {
      tenantId: driver.tenantId,
      driverId: driver.driverId,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
