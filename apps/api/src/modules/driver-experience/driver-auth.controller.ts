/**
 * /driver-auth/* — PIN-based login for the in-truck app + matching admin
 * endpoints (set PIN, clear failed attempts).
 *
 * The picker + login routes are @Public() so the global JwtAuthGuard
 * doesn't try to read an operator access token off the request. The set-
 * pin / clear-failed-attempts routes ride the operator session as normal
 * (OWNER/ADMIN/MANAGER via RolesGuard).
 */
import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ERROR_CODES, ROLES, createDriverPinSchema } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import {
  DriverAuthService,
  type DriverLoginResponse,
  type DriverPickerDto,
  type OperatorContext,
} from './driver-auth.service.js';

const listDriversSchema = z
  .object({
    tenantSlug: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/, 'invalid tenantSlug'),
  })
  .strict();

const lookupByCodeSchema = z
  .object({
    companyCode: z.string().regex(/^\d{6}$/, 'Company code must be 6 digits'),
  })
  .strict();

const driverLoginSchema = z
  .object({
    driverId: z.string().uuid(),
    pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
    tenantSlug: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/, 'invalid tenantSlug'),
  })
  .strict();

const clearFailedSchema = z.object({ driverId: z.string().uuid() }).strict();

@Controller('driver-auth')
export class DriverAuthController {
  constructor(private readonly auth: DriverAuthService) {}

  /**
   * Driver-app boot: device knows its tenant slug, asks for the picker.
   * Per spec: rate-limit 10/min per IP. We use the burst throttler — the
   * sustained one already enforces a wider cap.
   */
  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Post('list-drivers')
  @HttpCode(HttpStatus.OK)
  async listDrivers(@ZodBody(listDriversSchema) body: z.infer<typeof listDriversSchema>): Promise<{
    tenant: { id: string; slug: string; name: string };
    drivers: DriverPickerDto[];
  }> {
    return this.auth.listDriversForTenant(body.tenantSlug);
  }

  /**
   * Frictionless driver-app boot: the device passes the 6-digit company
   * code the dispatcher gave the driver. Returns the same payload as
   * /list-drivers so the picker UI can render without an extra round
   * trip. Rate-limited identically to /list-drivers.
   */
  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Post('lookup-by-code')
  @HttpCode(HttpStatus.OK)
  async lookupByCode(
    @ZodBody(lookupByCodeSchema) body: z.infer<typeof lookupByCodeSchema>,
  ): Promise<{
    tenant: { id: string; slug: string; name: string };
    drivers: DriverPickerDto[];
  }> {
    return this.auth.listDriversByCompanyCode(body.companyCode);
  }

  @Public()
  @Throttle({
    burst: { limit: 10, ttl: seconds(60) },
    sustained: { limit: 60, ttl: seconds(900) },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @ZodBody(driverLoginSchema) body: z.infer<typeof driverLoginSchema>,
  ): Promise<DriverLoginResponse> {
    return this.auth.login(body);
  }

  /**
   * Operator endpoint. Sets / rotates a driver's PIN. The shared schema
   * accepts 4–8 digits but the in-truck UX is a 4-digit keypad, so we
   * narrow to exactly 4 digits at the service layer.
   */
  @UseGuards(RolesGuard)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  @Post('set-pin')
  @HttpCode(HttpStatus.OK)
  async setPin(
    @ZodBody(createDriverPinSchema) body: { driverId: string; pin: string },
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    if (!/^\d{4}$/.test(body.pin)) {
      // The shared createDriverPinSchema accepts 4–8 digits because the
      // schema must serve future PIN-length flexibility, but the
      // in-truck UX is a fixed 4-digit keypad. Reject the wider input
      // here with a clean 400 before bcrypt does any work.
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'PIN must be exactly 4 digits',
      });
    }
    return this.auth.setPin(this.operatorCtx(req), body);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  @Post('clear-failed-attempts')
  @HttpCode(HttpStatus.OK)
  async clearFailedAttempts(
    @ZodBody(clearFailedSchema) body: z.infer<typeof clearFailedSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    return this.auth.clearFailedAttempts(this.operatorCtx(req), body);
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
