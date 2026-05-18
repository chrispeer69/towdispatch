import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CreateDriverTelemetryBatchPayload,
  type CreateDriverTelemetryEventPayload,
  type DriverTelemetryEventDto,
  createDriverTelemetryBatchSchema,
  createDriverTelemetryEventSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverTelemetryService } from './driver-telemetry.service.js';

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-telemetry')
export class DriverTelemetryController {
  constructor(private readonly telemetry: DriverTelemetryService) {}

  @Post('ping')
  @HttpCode(HttpStatus.CREATED)
  async ping(
    @ZodBody(createDriverTelemetryEventSchema) body: CreateDriverTelemetryEventPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverTelemetryEventDto> {
    return this.telemetry.ping(this.driverCtx(driver, req), body);
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batch(
    @ZodBody(createDriverTelemetryBatchSchema) body: CreateDriverTelemetryBatchPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<{ inserted: number }> {
    return this.telemetry.pingBatch(this.driverCtx(driver, req), body);
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
