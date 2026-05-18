/**
 * /driver-briefings/* — admin authoring + driver acknowledgement.
 *
 * Admin endpoints (POST /, PATCH /:id) ride the operator JWT and require
 * OWNER or ADMIN. Driver-facing endpoints (GET /active, /needs-…,
 * POST /:id/acknowledge) are @Public() — gated by DriverAuthGuard instead.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateDriverBriefingAcknowledgmentPayload,
  type CreateDriverDailyBriefingPayload,
  type DriverBriefingAcknowledgmentDto,
  type DriverDailyBriefingDto,
  ROLES,
  type UpdateDriverDailyBriefingPayload,
  createDriverBriefingAcknowledgmentSchema,
  createDriverDailyBriefingSchema,
  updateDriverDailyBriefingSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CurrentDriver } from './current-driver.decorator.js';
import { type DriverAuthContext, DriverAuthGuard } from './driver-auth.guard.js';
import type { OperatorContext } from './driver-auth.service.js';
import { DriverBriefingService } from './driver-briefing.service.js';

const idSchema = z.object({ id: z.string().uuid() }).strict();

@Controller('driver-briefings')
export class DriverBriefingController {
  constructor(private readonly briefings: DriverBriefingService) {}

  // ---------- Driver-facing (driver JWT) ----------

  @Public()
  @UseGuards(DriverAuthGuard)
  @Get('active')
  async active(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverDailyBriefingDto> {
    return this.briefings.getActive(this.driverCtx(driver, req));
  }

  @Public()
  @UseGuards(DriverAuthGuard)
  @Get('needs-acknowledgment')
  async needs(
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<{ needs: boolean; briefing: DriverDailyBriefingDto | null }> {
    return this.briefings.needsAcknowledgment(this.driverCtx(driver, req));
  }

  @Public()
  @UseGuards(DriverAuthGuard)
  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  async acknowledge(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(createDriverBriefingAcknowledgmentSchema)
    body: CreateDriverBriefingAcknowledgmentPayload,
    @CurrentDriver() driver: DriverAuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DriverBriefingAcknowledgmentDto> {
    return this.briefings.acknowledge(this.driverCtx(driver, req), params.id, body);
  }

  // ---------- Admin (operator JWT + RBAC) ----------

  @UseGuards(RolesGuard)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @ZodBody(createDriverDailyBriefingSchema) body: CreateDriverDailyBriefingPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverDailyBriefingDto> {
    return this.briefings.create(this.operatorCtx(req), body);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @Patch(':id')
  async patch(
    @ZodParam(idSchema) params: { id: string },
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<DriverDailyBriefingDto> {
    const body: UpdateDriverDailyBriefingPayload = updateDriverDailyBriefingSchema.parse(rawBody);
    return this.briefings.patch(this.operatorCtx(req), params.id, body);
  }

  private driverCtx(
    driver: DriverAuthContext,
    req: FastifyRequest,
  ): {
    tenantId: string;
    driverId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
    const c = req.requestContext;
    return {
      tenantId: driver.tenantId,
      driverId: driver.driverId,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }

  private operatorCtx(req: FastifyRequest): OperatorContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
