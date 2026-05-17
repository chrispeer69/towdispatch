import { Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  type CompanyProfilePatchPayload,
  ROLES,
  type TenantDto,
  companyProfilePatchSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantsService } from './tenants.service.js';

@UseGuards(RolesGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('current')
  async current(@Req() req: FastifyRequest): Promise<TenantDto> {
    return this.tenants.getCurrent(this.callerCtx(req));
  }

  @Patch('current')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async update(
    @ZodBody(companyProfilePatchSchema) body: CompanyProfilePatchPayload,
    @Req() req: FastifyRequest,
  ): Promise<TenantDto> {
    return this.tenants.updateCurrent(this.callerCtx(req), body);
  }

  private callerCtx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
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
