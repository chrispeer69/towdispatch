/**
 * /voice-driver/* — driver-JWT-gated voice command surface (Session 45).
 *
 * Mirrors the EV / driver-jobs pattern: `@Public()` so the operator
 * JwtAuthGuard doesn't intercept, then `DriverAuthGuard` verifies the
 * driver token. The single endpoint takes a transcript and returns the
 * string the native app speaks back.
 *
 * The whole surface is gated behind VOICE_DRIVER_ENABLED — when off it
 * returns 503 service_unavailable rather than silently accepting commands.
 */
import { Controller, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import {
  ERROR_CODES,
  type VoiceCommandResponse,
  voiceCommandRequestSchema,
} from '@ustowdispatch/shared';
import type { VoiceCommandRequest } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { ConfigService } from '../../config/config.service.js';
import { CurrentDriver } from '../driver-experience/current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from '../driver-experience/driver-auth.guard.js';
import { type VoiceDriverCtx, VoiceDriverService } from './voice-driver.service.js';

@Public()
@UseGuards(DriverAuthGuard)
@Controller('voice-driver')
export class VoiceDriverController {
  constructor(
    private readonly service: VoiceDriverService,
    private readonly config: ConfigService,
  ) {}

  @Post('command')
  async command(
    @ZodBody(voiceCommandRequestSchema) body: VoiceCommandRequest,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<VoiceCommandResponse> {
    if (!this.config.voiceDriverEnabled) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Voice driver workflows are disabled',
      });
    }
    return this.service.handleCommand(this.ctx(driver, req), body);
  }

  private ctx(driver: DriverAuthContext, req: FastifyRequest): VoiceDriverCtx {
    const c = req.requestContext;
    return {
      tenantId: driver.tenantId,
      driverId: driver.driverId,
      requestId: c.requestId,
      ipAddress: c.ipAddress ?? null,
      userAgent: c.userAgent ?? null,
    };
  }
}
