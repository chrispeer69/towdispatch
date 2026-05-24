/**
 * AdminService — read surface over the append-only audit_log table for the
 * SOC 2 audit-log reader (GET /admin/audit-log).
 *
 * Every query runs inside the caller's tenant transaction, so Postgres RLS
 * confines results to the caller's own tenant — there is no cross-tenant read
 * path here by design (that would need a platform-superadmin role we do not
 * have; see SESSION_31_DECISIONS.md). Filters AND together. Results are newest
 * first and paginated.
 *
 * before_state / after_state are full row snapshots that can contain secrets,
 * so every snapshot is passed through redactState() before it leaves the
 * service — see audit-redaction.ts.
 */
import { Injectable } from '@nestjs/common';
import { auditLog, users } from '@ustowdispatch/db';
import type {
  AuditAnomaliesQuery,
  AuditAnomaliesReport,
  AuditLogQuery,
  FailedLoginAnomaly,
  PaginatedAuditLog,
} from '@ustowdispatch/shared';
import { type SQL, and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { classifyAuditAnomalies } from './audit-anomalies.js';
import { redactState } from './audit-redaction.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminService {
  constructor(private readonly db: TenantAwareDb) {}

  async queryAuditLog(ctx: CallerContext, filters: AuditLogQuery): Promise<PaginatedAuditLog> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds: SQL[] = [];
      if (filters.actorId) conds.push(eq(auditLog.actorId, filters.actorId));
      if (filters.resourceType) conds.push(eq(auditLog.resourceType, filters.resourceType));
      if (filters.resourceId) conds.push(eq(auditLog.resourceId, filters.resourceId));
      if (filters.action) conds.push(eq(auditLog.action, filters.action));
      if (filters.from) conds.push(gte(auditLog.createdAt, new Date(filters.from)));
      if (filters.to) conds.push(lte(auditLog.createdAt, new Date(filters.to)));
      const whereExpr = conds.length ? and(...conds) : undefined;

      const [totalRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(whereExpr);
      const total = totalRow?.count ?? 0;

      const rows = await tx
        .select({
          id: auditLog.id,
          tenantId: auditLog.tenantId,
          actorId: auditLog.actorId,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          beforeState: auditLog.beforeState,
          afterState: auditLog.afterState,
          requestId: auditLog.requestId,
          ipAddress: auditLog.ipAddress,
          userAgent: auditLog.userAgent,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(whereExpr)
        .orderBy(desc(auditLog.createdAt))
        .limit(filters.perPage)
        .offset((filters.page - 1) * filters.perPage);

      return {
        data: rows.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          actorId: r.actorId ?? null,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId ?? null,
          beforeState: redactState(r.beforeState as Record<string, unknown> | null),
          afterState: redactState(r.afterState as Record<string, unknown> | null),
          requestId: r.requestId ?? null,
          ipAddress: r.ipAddress ?? null,
          userAgent: r.userAgent ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        page: filters.page,
        perPage: filters.perPage,
        total,
      };
    });
  }

  /**
   * Advisory anomaly surface over audit_log + users (SOC 2 Type II monitoring
   * effectiveness). Tenant-scoped via RLS exactly like queryAuditLog — there is
   * no cross-tenant path. Flags only; never blocks. Each signal reads one row
   * past `limit` so the report can honestly report truncation.
   */
  async queryAnomalies(ctx: CallerContext, q: AuditAnomaliesQuery): Promise<AuditAnomaliesReport> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const since = new Date(Date.now() - q.windowDays * 86_400_000);

      // Admin/owner audit activity in the window, joined to the actor for
      // identity + current role. One extra row read to detect truncation.
      const auditRows = await tx
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          createdAt: auditLog.createdAt,
          actorEmail: users.email,
          actorRole: users.role,
        })
        .from(auditLog)
        .innerJoin(users, eq(auditLog.actorId, users.id))
        .where(and(gte(auditLog.createdAt, since), inArray(users.role, ['owner', 'admin'])))
        .orderBy(desc(auditLog.createdAt))
        .limit(q.limit + 1);

      const auditTruncated = auditRows.length > q.limit;
      const { adminDeletes, offHoursAdminActivity } = classifyAuditAnomalies(
        auditRows.slice(0, q.limit).map((r) => ({
          id: r.id,
          actorId: r.actorId ?? null,
          actorEmail: r.actorEmail ?? null,
          actorRole: r.actorRole ?? null,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId ?? null,
          createdAt: r.createdAt,
        })),
        { startUtc: q.offHoursStartUtc, endUtc: q.offHoursEndUtc },
      );

      // Failed-login spikes: a counter on the user row (active accounts only),
      // not an audit event — see SESSION_40_DECISIONS.md D6.
      const now = new Date();
      const spikeRows = await tx
        .select({
          userId: users.id,
          email: users.email,
          role: users.role,
          failedLoginCount: users.failedLoginCount,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            or(gte(users.failedLoginCount, q.failedLoginThreshold), gt(users.lockedUntil, now)),
          ),
        )
        .orderBy(desc(users.failedLoginCount))
        .limit(q.limit + 1);

      const spikeTruncated = spikeRows.length > q.limit;
      const failedLoginSpikes: FailedLoginAnomaly[] = spikeRows.slice(0, q.limit).map((r) => ({
        userId: r.userId,
        email: r.email,
        role: r.role,
        failedLoginCount: r.failedLoginCount,
        lockedUntil: r.lockedUntil ? r.lockedUntil.toISOString() : null,
      }));

      return {
        window: {
          days: q.windowDays,
          since: since.toISOString(),
          offHoursStartUtc: q.offHoursStartUtc,
          offHoursEndUtc: q.offHoursEndUtc,
          failedLoginThreshold: q.failedLoginThreshold,
        },
        adminDeletes,
        offHoursAdminActivity,
        failedLoginSpikes,
        summary: {
          adminDeletes: adminDeletes.length,
          offHoursAdminActivity: offHoursAdminActivity.length,
          failedLoginSpikes: failedLoginSpikes.length,
          truncated: auditTruncated || spikeTruncated,
        },
      };
    });
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}
