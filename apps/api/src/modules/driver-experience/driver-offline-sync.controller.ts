import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CreateDriverOfflineActionBatchPayload,
  createDriverOfflineActionBatchSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { DriverContext } from './driver-auth.service.js';
import {
  DriverOfflineSyncService,
  type OfflineReplayResultItem,
} from './driver-offline-sync.service.js';

@Public()
@UseGuards(DriverAuthGuard)
@Controller('driver-offline-sync')
export class DriverOfflineSyncController {
  constructor(private readonly sync: DriverOfflineSyncService) {}

  @Post('replay')
  @HttpCode(HttpStatus.OK)
  async replay(
    @ZodBody(createDriverOfflineActionBatchSchema) body: CreateDriverOfflineActionBatchPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<{ results: OfflineReplayResultItem[] }> {
    return this.sync.replay(this.driverCtx(driver, req), body);
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
