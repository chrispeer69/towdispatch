/**
 * GET /driver-trucks/mine — list trucks the authenticated driver is
 * qualified to operate. Used by the in-truck workspace shift-start flow.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import { type DriverTruckSummary, DriverTrucksService } from './driver-trucks.service.js';

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-trucks')
export class DriverTrucksController {
  constructor(private readonly trucks: DriverTrucksService) {}

  @Get('mine')
  async mine(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverTruckSummary[]> {
    return this.trucks.listMine(this.driverCtx(driver, req));
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
