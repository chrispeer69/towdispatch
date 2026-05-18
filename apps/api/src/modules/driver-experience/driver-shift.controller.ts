/**
 * /driver-shifts/* — driver-app facing shift endpoints. All three
 * routes are driver-JWT gated (DriverAuthGuard).
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { DriverShiftDto } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverShiftService } from './driver-shift.service.js';

const checkInSchema = z
  .object({
    truckId: z.string().uuid(),
    dvirId: z.string().uuid().optional(),
  })
  .strict();

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-shifts')
export class DriverShiftController {
  constructor(private readonly shifts: DriverShiftService) {}

  @Post('check-in')
  @HttpCode(HttpStatus.CREATED)
  async checkIn(
    @ZodBody(checkInSchema) body: z.infer<typeof checkInSchema>,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto> {
    return this.shifts.checkIn(this.driverCtx(driver, req), {
      truckId: body.truckId,
      ...(body.dvirId ? { dvirId: body.dvirId } : {}),
    });
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  async checkOut(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto> {
    return this.shifts.checkOut(this.driverCtx(driver, req));
  }

  @Get('me')
  async me(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto | null> {
    return this.shifts.getMyActiveShift(this.driverCtx(driver, req));
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
