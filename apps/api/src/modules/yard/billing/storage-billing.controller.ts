/**
 * StorageBillingController — the auto-billing run log + a manual "run now"
 * trigger (Yard Management, Session 54). run-now is WRITER-only; it bills the
 * caller's tenant for today regardless of the cron flag (the flag gates only
 * the scheduled sweep). Same YardEnabledGuard as the rest of the surface.
 */
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { storageBillingRuns } from '@ustowdispatch/db';
import { ROLES, type StorageBillingRunDto } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { YardEnabledGuard } from '../yard-enabled.guard.js';
import { StorageBillingService } from './storage-billing.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

@UseGuards(RolesGuard, YardEnabledGuard)
@Controller('yard/billing')
export class StorageBillingController {
  constructor(private readonly service: StorageBillingService) {}

  @Get('runs')
  @Roles(...READERS)
  async listRuns(@Req() req: FastifyRequest): Promise<StorageBillingRunDto[]> {
    const tenantId = req.requestContext.tenantId as string;
    const rows = await this.service.listRuns(tenantId);
    return rows.map(toRunDto);
  }

  @Post('run-now')
  @Roles(...WRITERS)
  async runNow(@Req() req: FastifyRequest) {
    const tenantId = req.requestContext.tenantId as string;
    return this.service.runForTenant(tenantId, new Date());
  }
}

function toRunDto(row: typeof storageBillingRuns.$inferSelect): StorageBillingRunDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    facilityId: row.facilityId,
    ranAt: row.ranAt.toISOString(),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    vehiclesCharged: row.vehiclesCharged,
    totalChargedCents: row.totalChargedCents,
    status: row.status,
    errorText: row.errorText,
  };
}
