/**
 * /apps/* (Session 46) — the tenant-operator install-management surface.
 *
 *   GET    /apps/installed          list this tenant's installed apps
 *   POST   /apps/:slug/install      resolve OAuth params to start an install
 *   DELETE /apps/installed/:id      uninstall (revokes tokens)
 *
 * Operator (OWNER/ADMIN) only, behind MARKETPLACE_API_ENABLED.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type BeginInstallPayload,
  type BeginInstallResult,
  type InstalledAppDto,
  ROLES,
  beginInstallSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { InstallsService, type OperatorCtx } from './installs.service.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';

@UseGuards(MarketplaceEnabledGuard, RolesGuard)
@Roles(ROLES.OWNER, ROLES.ADMIN)
@Controller('apps')
export class InstallsController {
  constructor(private readonly installs: InstallsService) {}

  @Get('installed')
  async listInstalled(@Req() req: FastifyRequest): Promise<InstalledAppDto[]> {
    return this.installs.listInstalled(this.ctx(req));
  }

  @Post(':slug/install')
  async beginInstall(
    @Param('slug') slug: string,
    @ZodBody(beginInstallSchema) body: BeginInstallPayload,
  ): Promise<BeginInstallResult> {
    return this.installs.begin(slug, body);
  }

  @Delete('installed/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async uninstall(@Param('id') id: string, @Req() req: FastifyRequest): Promise<void> {
    await this.installs.uninstall(this.ctx(req), id);
  }

  private ctx(req: FastifyRequest): OperatorCtx {
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
