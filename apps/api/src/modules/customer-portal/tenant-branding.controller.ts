/**
 * TenantBrandingController — staff-side white-label admin (Session 32).
 * Authenticated by the operator JWT (global JwtAuthGuard) + RBAC.
 *
 *   GET  /tenant-branding         OWNER/ADMIN/MANAGER/ACCOUNTING (read)
 *   PUT  /tenant-branding         OWNER/ADMIN                    (write)
 *   POST /tenant-branding/logo    OWNER/ADMIN                    (logo upload)
 */
import { Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  ROLES,
  type TenantBrandingDto,
  type UpdateTenantBrandingPayload,
  type UploadLogoPayload,
  updateTenantBrandingSchema,
  uploadLogoSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { type BrandingCallerCtx, TenantBrandingService } from './tenant-branding.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN] as const;

@UseGuards(RolesGuard)
@Controller('tenant-branding')
export class TenantBrandingController {
  constructor(private readonly service: TenantBrandingService) {}

  @Get()
  @Roles(...READERS)
  async get(@Req() req: FastifyRequest): Promise<TenantBrandingDto> {
    return this.service.getBranding(ctx(req));
  }

  @Put()
  @Roles(...WRITERS)
  async update(
    @Req() req: FastifyRequest,
    @ZodBody(updateTenantBrandingSchema) body: UpdateTenantBrandingPayload,
  ): Promise<TenantBrandingDto> {
    return this.service.updateBranding(ctx(req), body);
  }

  @Post('logo')
  @Roles(...WRITERS)
  async uploadLogo(
    @Req() req: FastifyRequest,
    @ZodBody(uploadLogoSchema) body: UploadLogoPayload,
  ): Promise<TenantBrandingDto> {
    return this.service.uploadLogo(ctx(req), body);
  }
}

function ctx(req: FastifyRequest): BrandingCallerCtx {
  const c = req.requestContext;
  return {
    tenantId: c.tenantId as string,
    userId: c.userId as string,
    requestId: c.requestId,
    ipAddress: c.ipAddress ?? undefined,
    userAgent: c.userAgent ?? undefined,
  };
}
