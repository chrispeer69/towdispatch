/**
 * Dashboard HTTP surface — single aggregate endpoint that returns every KPI
 * the /dashboard page renders, plus the recent-activity feed. One round trip
 * keeps the server-component fetch path simple and matches the dispatch
 * board's "snapshot in, websocket updates after" pattern.
 *
 * Drill-down endpoints power the per-panel pages (/active-calls,
 * /active-etas, /drivers/[id]/today) that hang off the Operations Overview
 * KPI tiles. They share the same role gate as /overview.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ROLES, type Role } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import {
  type ActiveCallsBreakdownDto,
  type DashboardOverviewDto,
  type DashboardRecentActivityItem,
  DashboardService,
  type DriverDayDto,
  type EtaBoardItem,
} from './dashboard.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const driverIdSchema = z.object({ id: z.string().uuid() });
const accountIdSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async overview(@Req() req: FastifyRequest): Promise<DashboardOverviewDto> {
    return this.dashboard.overview(this.callerCtx(req));
  }

  @Get('active-calls-breakdown')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async activeCallsBreakdown(@Req() req: FastifyRequest): Promise<ActiveCallsBreakdownDto> {
    return this.dashboard.activeCallsBreakdown(this.callerCtx(req));
  }

  @Get('active-calls/no-account')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async activeCallsNoAccount(@Req() req: FastifyRequest): Promise<DashboardRecentActivityItem[]> {
    return this.dashboard.activeCallsForAccount(this.callerCtx(req), null);
  }

  @Get('active-calls/account/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async activeCallsForAccount(
    @ZodParam(accountIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<DashboardRecentActivityItem[]> {
    return this.dashboard.activeCallsForAccount(this.callerCtx(req), params.id);
  }

  @Get('eta-board')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async etaBoard(@Req() req: FastifyRequest): Promise<EtaBoardItem[]> {
    return this.dashboard.etaBoard(this.callerCtx(req));
  }

  @Get('driver-day/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async driverDay(
    @ZodParam(driverIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<DriverDayDto> {
    return this.dashboard.driverDay(this.callerCtx(req), params.id);
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
