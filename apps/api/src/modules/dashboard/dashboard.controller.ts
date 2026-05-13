/**
 * Dashboard HTTP surface — single aggregate endpoint that returns every KPI
 * the /dashboard page renders, plus the recent-activity feed. One round trip
 * keeps the server-component fetch path simple and matches the dispatch
 * board's "snapshot in, websocket updates after" pattern.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ROLES, type Role } from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { type DashboardOverviewDto, DashboardService } from './dashboard.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async overview(@Req() req: FastifyRequest): Promise<DashboardOverviewDto> {
    return this.dashboard.overview(this.callerCtx(req));
  }

  private callerCtx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      role: c.role as Role | null,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
