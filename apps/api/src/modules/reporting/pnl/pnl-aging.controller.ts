/**
 * /reporting/pnl/* and /reporting/aging/* — financial reporting (Session 53).
 *
 * Additive, read-only endpoints alongside the canned reporters. P&L is
 * per-account and per-motor-club; aging exposes the per-account buckets plus
 * the open-invoice drill-down the billing report lacked. Financial roles only.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  type AgingDrilldownResponse,
  type AgingReportResponse,
  type PnlResponse,
  ROLES,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodParam, ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { AgingService } from '../aging/aging.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { PnlService } from './pnl.service.js';

const pnlQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  account_id: z.string().uuid().optional(),
  motor_club_id: z.string().uuid().optional(),
});

const agingQuerySchema = z.object({
  as_of: z.string().datetime().optional(),
  bucket_days: z.string().max(40).optional(),
  account_id: z.string().uuid().optional(),
});

const drilldownQuerySchema = z.object({
  as_of: z.string().datetime().optional(),
  bucket_days: z.string().max(40).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('reporting')
export class PnlAgingController {
  constructor(
    private readonly pnl: PnlService,
    private readonly aging: AgingService,
  ) {}

  @Get('pnl/accounts')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async pnlAccounts(
    @ZodQuery(pnlQuerySchema) q: z.infer<typeof pnlQuerySchema>,
    @Req() req: FastifyRequest,
  ): Promise<PnlResponse> {
    return this.pnl.pnl(this.ctx(req), 'accounts', new Date(q.from), new Date(q.to), q.account_id);
  }

  @Get('pnl/motor-clubs')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async pnlMotorClubs(
    @ZodQuery(pnlQuerySchema) q: z.infer<typeof pnlQuerySchema>,
    @Req() req: FastifyRequest,
  ): Promise<PnlResponse> {
    return this.pnl.pnl(
      this.ctx(req),
      'motor-clubs',
      new Date(q.from),
      new Date(q.to),
      q.motor_club_id,
    );
  }

  @Get('aging')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async agingReport(
    @ZodQuery(agingQuerySchema) q: z.infer<typeof agingQuerySchema>,
    @Req() req: FastifyRequest,
  ): Promise<AgingReportResponse> {
    return this.aging.aging(
      this.ctx(req),
      q.as_of ? new Date(q.as_of) : new Date(),
      parseBuckets(q.bucket_days),
      q.account_id,
    );
  }

  @Get('aging/accounts/:id/invoices')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async agingDrilldown(
    @ZodParam(idSchema) p: { id: string },
    @ZodQuery(drilldownQuerySchema) q: z.infer<typeof drilldownQuerySchema>,
    @Req() req: FastifyRequest,
  ): Promise<AgingDrilldownResponse> {
    return this.aging.drilldown(
      this.ctx(req),
      p.id,
      q.as_of ? new Date(q.as_of) : new Date(),
      parseBuckets(q.bucket_days),
    );
  }

  private ctx(req: FastifyRequest): AuthCtx {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      role: (c.role as string | null) ?? null,
    };
  }
}

function parseBuckets(csv: string | undefined): number[] | undefined {
  if (!csv) return undefined;
  return csv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}
