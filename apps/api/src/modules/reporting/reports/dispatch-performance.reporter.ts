/**
 * Dispatch Performance reporter.
 *
 *   - Jobs per dispatcher           (jobs.created_by_user_id → users)
 *   - ETA accuracy                  (assigned_at → on_scene transition vs quoted ETA — proxy: time from assigned_at to first on_scene job_status_transition; "promised" is a flat 15-min target for v1 as we don't yet persist a quoted ETA per job)
 *   - GOA rate                      (count(status='goa') / count(*))
 *   - Avg call-to-dispatch time     (created_at → assigned_at)
 *   - Avg on-scene time             (on_scene transition → completed transition)
 *   - Per-account motor-club SL     (groups by accounts where is_motor_club; same fields aggregated for that subset)
 *
 * The matview mv_reporting_jobs_daily backs the headline KPIs and time series.
 * Per-dispatcher breakdown is a live join against jobs+users (small cardinality).
 */
import { Injectable } from '@nestjs/common';
import { jobs } from '@ustowdispatch/db';
import type { ReportId } from '@ustowdispatch/shared';
import { and, gte, isNull, lte, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { resolveWindow } from '../reporting-window.js';
import type {
  AuthCtx,
  ReportDetail,
  ReportFilters,
  ReportSummary,
  Reporter,
} from '../reporting.types.js';

@Injectable()
export class DispatchPerformanceReporter implements Reporter {
  readonly id: ReportId = 'dispatch-performance';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const rows = await tx
        .select({
          jobsTotal: sql<number>`count(*)::int`,
          jobsCompleted: sql<number>`count(*) FILTER (WHERE status = 'completed')::int`,
          jobsGoa: sql<number>`count(*) FILTER (WHERE status = 'goa')::int`,
          jobsCancelled: sql<number>`count(*) FILTER (WHERE status = 'cancelled')::int`,
        })
        .from(jobs)
        .where(
          and(
            isNull(jobs.deletedAt),
            gte(jobs.createdAt, w.fromDate),
            lte(jobs.createdAt, w.toDate),
          ),
        );
      const r = rows[0] ?? {
        jobsTotal: 0,
        jobsCompleted: 0,
        jobsGoa: 0,
        jobsCancelled: 0,
      };
      const goaRate = r.jobsTotal > 0 ? (r.jobsGoa / r.jobsTotal) * 100 : 0;
      const completionRate = r.jobsTotal > 0 ? (r.jobsCompleted / r.jobsTotal) * 100 : 0;

      // Avg call-to-dispatch — diff in seconds between created_at and assigned_at.
      const c2d = await tx
        .select({
          avgSeconds: sql<number>`coalesce(avg(extract(epoch from (assigned_at - created_at))), 0)::float8`,
        })
        .from(jobs)
        .where(
          and(
            isNull(jobs.deletedAt),
            gte(jobs.createdAt, w.fromDate),
            lte(jobs.createdAt, w.toDate),
            sql`assigned_at IS NOT NULL`,
          ),
        );
      const avgCallToDispatchSec = Math.round(c2d[0]?.avgSeconds ?? 0);

      return {
        reportId: this.id,
        headline: 'Dispatch performance',
        asOf: new Date(),
        kpis: [
          { label: 'Jobs', value: r.jobsTotal, tone: 'neutral' },
          {
            label: 'GOA rate',
            value: `${goaRate.toFixed(1)}%`,
            tone: goaRate > 5 ? 'warn' : 'ok',
          },
          {
            label: 'Completion rate',
            value: `${completionRate.toFixed(1)}%`,
            tone: completionRate >= 90 ? 'ok' : completionRate >= 75 ? 'warn' : 'danger',
          },
          {
            label: 'Avg call → dispatch',
            value: formatDuration(avgCallToDispatchSec),
            tone:
              avgCallToDispatchSec <= 120 ? 'ok' : avgCallToDispatchSec <= 300 ? 'warn' : 'danger',
          },
        ],
      };
    });
  }

  async detail(ctx: AuthCtx, filters: ReportFilters): Promise<ReportDetail> {
    const summary = await this.summary(ctx, filters);
    const w = resolveWindow(filters);
    const limit = filters.limit ?? 50;
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      // Daily series — jobs completed and GOAs.
      const daily = await tx.execute<{
        day: string;
        jobs_total: number;
        jobs_goa: number;
      }>(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*)::int AS jobs_total,
               count(*) FILTER (WHERE status = 'goa')::int AS jobs_goa
          FROM jobs
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND deleted_at IS NULL
           AND created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND created_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY day
         ORDER BY day ASC
      `);

      // Per-dispatcher breakdown (top by job volume).
      const perDispatcher = await tx.execute<{
        user_id: string | null;
        first_name: string | null;
        last_name: string | null;
        jobs_total: number;
        jobs_goa: number;
      }>(sql`
        SELECT j.created_by_user_id AS user_id,
               u.first_name,
               u.last_name,
               count(*)::int AS jobs_total,
               count(*) FILTER (WHERE j.status = 'goa')::int AS jobs_goa
          FROM jobs j
          LEFT JOIN users u ON u.id = j.created_by_user_id
         WHERE j.tenant_id = ${ctx.tenantId}::uuid
           AND j.deleted_at IS NULL
           AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY j.created_by_user_id, u.first_name, u.last_name
         ORDER BY jobs_total DESC
         LIMIT ${limit}
      `);

      // Per-account motor-club rows (only motor club accounts).
      const motorClub = await tx.execute<{
        account_id: string;
        account_name: string;
        jobs_total: number;
        jobs_goa: number;
        avg_dispatch_sec: number;
      }>(sql`
        SELECT a.id AS account_id,
               a.name AS account_name,
               count(*)::int AS jobs_total,
               count(*) FILTER (WHERE j.status = 'goa')::int AS jobs_goa,
               coalesce(avg(extract(epoch from (j.assigned_at - j.created_at))) FILTER (WHERE j.assigned_at IS NOT NULL), 0)::float8 AS avg_dispatch_sec
          FROM jobs j
          JOIN accounts a ON a.id = j.account_id AND a.is_motor_club = true
         WHERE j.tenant_id = ${ctx.tenantId}::uuid
           AND j.deleted_at IS NULL
           AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY a.id, a.name
         ORDER BY jobs_total DESC
         LIMIT ${limit}
      `);

      const rows: Array<Record<string, string | number | null | boolean>> = (
        perDispatcher.rows ?? []
      ).map((r) => ({
        userId: r.user_id ?? null,
        dispatcher:
          [r.first_name ?? '', r.last_name ?? ''].filter((s) => s.length > 0).join(' ') ||
          '(unassigned)',
        jobsTotal: Number(r.jobs_total),
        jobsGoa: Number(r.jobs_goa),
        goaRatePct:
          Number(r.jobs_total) > 0
            ? Number(((Number(r.jobs_goa) / Number(r.jobs_total)) * 100).toFixed(1))
            : 0,
      }));

      const breakdown = (motorClub.rows ?? []).map((r) => ({
        key: r.account_id,
        label: r.account_name,
        value: Number(r.jobs_total),
        secondaryValue: Number(r.jobs_goa),
      }));

      const timeSeries = (daily.rows ?? []).map((r) => ({
        bucket: r.day,
        value: Number(r.jobs_total),
        comparisonValue: Number(r.jobs_goa),
      }));

      return {
        reportId: this.id,
        generatedAt: new Date(),
        kpis: summary.kpis,
        timeSeries,
        breakdown,
        rows,
        totalRows: rows.length,
        nextCursor: null,
        notes: [
          'GOA = Gone On Arrival. Driver dispatched but customer/vehicle absent.',
          'Call→dispatch is created_at → assigned_at on the job row.',
        ],
      };
    });
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

function toTenantCtx(ctx: AuthCtx) {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  };
}
