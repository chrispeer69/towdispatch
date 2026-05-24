/**
 * Admin HTTP surface — SOC 2 audit-log reader.
 *
 * GET /admin/audit-log returns the tenant's append-only audit trail, filtered
 * and paginated. Restricted to OWNER / ADMIN (operators who manage the account)
 * and AUDITOR (the read-only role we expose to an external SOC 2 auditor). RLS
 * confines every result to the caller's own tenant.
 */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ROLES, type Role } from '@ustowdispatch/shared';
import {
  type AuditAnomaliesQuery,
  type AuditAnomaliesReport,
  type AuditLogQuery,
  type PaginatedAuditLog,
  auditAnomaliesQuerySchema,
  auditLogQuerySchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminService } from './admin.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('audit-log')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.AUDITOR)
  async auditLog(
    @ZodQuery(auditLogQuerySchema) query: AuditLogQuery,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedAuditLog> {
    return this.admin.queryAuditLog(this.callerCtx(req), query);
  }

  /**
   * Advisory anomaly surface over the audit trail (SOC 2 Type II). Surfaces
   * admin deletes, off-hours admin activity, and failed-login spikes for the
   * caller's tenant. Same roles + RLS scoping as the reader. Read-only; flags
   * but never blocks.
   */
  @Get('audit-log/anomalies')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.AUDITOR)
  async auditLogAnomalies(
    @ZodQuery(auditAnomaliesQuerySchema) query: AuditAnomaliesQuery,
    @Req() req: FastifyRequest,
  ): Promise<AuditAnomaliesReport> {
    return this.admin.queryAnomalies(this.callerCtx(req), query);
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
