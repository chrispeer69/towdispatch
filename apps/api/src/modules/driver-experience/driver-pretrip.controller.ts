import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CreateDriverPretripInspectionPayload,
  type DriverPretripInspectionDto,
  createDriverPretripInspectionSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverPretripService } from './driver-pretrip.service.js';

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-pretrip')
export class DriverPretripController {
  constructor(private readonly pretrip: DriverPretripService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @ZodBody(createDriverPretripInspectionSchema) body: CreateDriverPretripInspectionPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverPretripInspectionDto> {
    return this.pretrip.create(this.driverCtx(driver, req), body);
  }

  @Get('my-recent')
  async myRecent(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverPretripInspectionDto[]> {
    return this.pretrip.listMyRecent(this.driverCtx(driver, req));
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
