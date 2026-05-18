import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CreateJobFieldPaymentPayload,
  type JobFieldPaymentDto,
  createJobFieldPaymentSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverFieldPaymentService } from './driver-field-payment.service.js';

const idSchema = z.object({ id: z.string().uuid() }).strict();

@Public()
@UseGuards(DriverAuthGuard)
@Controller('job-field-payments')
export class DriverFieldPaymentController {
  constructor(private readonly payments: DriverFieldPaymentService) {}

  @Post('create-intent')
  @HttpCode(HttpStatus.CREATED)
  async createIntent(
    @ZodBody(createJobFieldPaymentSchema) body: CreateJobFieldPaymentPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<JobFieldPaymentDto> {
    return this.payments.createIntent(this.driverCtx(driver, req), body);
  }

  @Post(':id/capture')
  @HttpCode(HttpStatus.OK)
  async capture(
    @ZodParam(idSchema) params: { id: string },
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<JobFieldPaymentDto> {
    return this.payments.capture(this.driverCtx(driver, req), params.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @ZodParam(idSchema) params: { id: string },
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<JobFieldPaymentDto> {
    return this.payments.cancel(this.driverCtx(driver, req), params.id);
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
