/**
 * CapacityPullController — the partner-facing pull surface.
 *
 *   GET /v1/capacity          — live signal (Redis-cached), same payload
 *                               shape as the outbound webhook.
 *   GET /v1/capacity/history  — capacity_snapshots time series, bounded
 *                               to 168h and paginated.
 *
 * Auth is CapacityPartnerKeyGuard (per-partner key, 60/min). Both routes
 * scope class data to the partner's class visibility; the blended figure
 * always ships.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { capacitySnapshots } from '@ustowdispatch/db';
import type { CapacityHistoryResponse, CapacityPayload } from '@ustowdispatch/shared';
import { CAPACITY_SCHEMA_VERSION } from '@ustowdispatch/shared';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../../common/decorators/public.decorator.js';
import { ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { buildCapacityPayload } from '../capacity-broadcast.service.js';
import { CapacityComputeService } from '../capacity-compute.service.js';
import type { ResolvedCapacityPartner } from './capacity-partner-key.guard.js';
import { CapacityPartnerKeyGuard } from './capacity-partner-key.guard.js';

const historyQuery = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(100),
});
type HistoryQuery = z.infer<typeof historyQuery>;

@Public()
@UseGuards(CapacityPartnerKeyGuard)
@Controller('v1/capacity')
export class CapacityPullController {
  constructor(
    private readonly compute: CapacityComputeService,
    private readonly admin: TransactionRunner,
  ) {}

  @Get()
  async live(@Req() req: FastifyRequest): Promise<CapacityPayload> {
    const partner = this.partner(req);
    const status = await this.compute.getStatus(partner.tenantId);
    const tenantName = await this.compute.tenantName(partner.tenantId);
    return buildCapacityPayload(partner.tenantId, tenantName, status, partner.classVisibility);
  }

  @Get('history')
  async history(
    @Req() req: FastifyRequest,
    @ZodQuery(historyQuery) query: HistoryQuery,
  ): Promise<CapacityHistoryResponse> {
    const partner = this.partner(req);
    const since = new Date(Date.now() - query.hours * 60 * 60 * 1000);
    const visibleScopes = [...partner.classVisibility, 'all'];

    const { rows, total } = await this.admin.runAsAdmin({}, async (db) => {
      const where = and(
        eq(capacitySnapshots.tenantId, partner.tenantId),
        isNull(capacitySnapshots.deletedAt),
        gte(capacitySnapshots.computedAt, since),
        inArray(
          capacitySnapshots.dutyClass,
          visibleScopes as (typeof capacitySnapshots.dutyClass.enumValues)[number][],
        ),
      );
      const [countRow] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(capacitySnapshots)
        .where(where);
      const page = await db
        .select()
        .from(capacitySnapshots)
        .where(where)
        .orderBy(desc(capacitySnapshots.computedAt))
        .limit(query.per_page)
        .offset((query.page - 1) * query.per_page);
      return { rows: page, total: countRow?.total ?? 0 };
    });

    return {
      schema_version: CAPACITY_SCHEMA_VERSION,
      tenant_id: partner.tenantId,
      hours: query.hours,
      page: query.page,
      per_page: query.per_page,
      total,
      entries: rows.map((r) => ({
        duty_class: r.dutyClass,
        status: r.band,
        ratio: r.ratio === null ? null : Number(r.ratio),
        drivers: r.eligibleDrivers,
        active_jobs: Number(r.weightedActiveJobs),
        override_active: r.overrideActive,
        computed_at: r.computedAt.toISOString(),
      })),
    };
  }

  private partner(req: FastifyRequest): ResolvedCapacityPartner {
    const partner = req.capacityPartner;
    if (!partner) throw new Error('CapacityPartnerKeyGuard did not run'); // unreachable
    return partner;
  }
}
