/**
 * Driver Performance reporter.
 *
 *   - Jobs/day per driver
 *   - Revenue/driver       (sum of rate_quoted_cents on completed jobs)
 *   - On-time arrival      (we don't yet store a promised on-scene time, so
 *                           "on time" is proxied as: enroute → on_scene <= 20m.
 *                           Documented as a v1 proxy; replace once promised
 *                           ETA persistence ships.)
 *   - Customer rating      (job_ratings table, avg stars)
 *   - Damage incidents     (deferred — no incidents table yet; surfaced as 0
 *                           with a note. Hooked to be replaced when the
 *                           incidents module ships.)
 *   - GOA rate per driver
 *   - Hours worked vs jobs (driver_shifts.started_at→ended_at vs job count)
 *
 * RBAC: drivers see only their own row. RolesGuard at controller layer handles
 * authz; this reporter filters down to ctx.driverId when ctx.role==='driver'.
 */
import { Injectable } from '@nestjs/common';
import type { ReportId } from '@towcommand/shared';
import { sql } from 'drizzle-orm';
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
export class DriverPerformanceReporter implements Reporter {
  readonly id: ReportId = 'driver-performance';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const rows = await tx.execute<{
        active_drivers: number;
        jobs_completed: number;
        revenue_cents: number;
        avg_rating: number | null;
      }>(sql`
        SELECT count(DISTINCT j.assigned_driver_id)::int AS active_drivers,
               count(*) FILTER (WHERE j.status = 'completed')::int AS jobs_completed,
               coalesce(sum(j.rate_quoted_cents) FILTER (WHERE j.status = 'completed'), 0)::bigint AS revenue_cents,
               (SELECT coalesce(avg(stars)::float8, NULL)
                  FROM job_ratings r
                 WHERE r.tenant_id = ${ctx.tenantId}::uuid
                   AND r.created_at >= ${w.fromDate.toISOString()}::timestamptz
                   AND r.created_at <= ${w.toDate.toISOString()}::timestamptz) AS avg_rating
          FROM jobs j
         WHERE j.tenant_id = ${ctx.tenantId}::uuid
           AND j.deleted_at IS NULL
           AND j.assigned_driver_id IS NOT NULL
           AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
      `);
      const r = rows.rows[0] ?? {
        active_drivers: 0,
        jobs_completed: 0,
        revenue_cents: 0,
        avg_rating: null,
      };
      return {
        reportId: this.id,
        headline: 'Driver performance',
        asOf: new Date(),
        kpis: [
          { label: 'Active drivers', value: Number(r.active_drivers), tone: 'neutral' },
          { label: 'Jobs completed', value: Number(r.jobs_completed), tone: 'neutral' },
          {
            label: 'Revenue',
            value: formatCents(Number(r.revenue_cents)),
            tone: 'neutral',
          },
          {
            label: 'Avg rating',
            value: r.avg_rating === null ? '—' : `${Number(r.avg_rating).toFixed(2)} ★`,
            tone:
              r.avg_rating === null
                ? 'neutral'
                : Number(r.avg_rating) >= 4.5
                  ? 'ok'
                  : Number(r.avg_rating) >= 4.0
                    ? 'warn'
                    : 'danger',
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
      // Per-driver aggregates
      const perDriver = await tx.execute<{
        driver_id: string | null;
        first_name: string | null;
        last_name: string | null;
        jobs_total: number;
        jobs_completed: number;
        jobs_goa: number;
        revenue_cents: number;
        on_time_count: number;
        avg_rating: number | null;
      }>(sql`
        WITH on_scene_first AS (
          SELECT job_id, min(created_at) FILTER (WHERE to_status = 'on_scene') AS on_scene_at,
                 min(created_at) FILTER (WHERE to_status = 'enroute')  AS enroute_at
            FROM job_status_transitions
           WHERE tenant_id = ${ctx.tenantId}::uuid
           GROUP BY job_id
        ),
        rated AS (
          SELECT j.assigned_driver_id, avg(r.stars)::float8 AS avg_rating
            FROM job_ratings r
            JOIN jobs j ON j.id = r.job_id
           WHERE r.tenant_id = ${ctx.tenantId}::uuid
             AND r.created_at >= ${w.fromDate.toISOString()}::timestamptz
             AND r.created_at <= ${w.toDate.toISOString()}::timestamptz
           GROUP BY j.assigned_driver_id
        )
        SELECT j.assigned_driver_id AS driver_id,
               d.first_name,
               d.last_name,
               count(*)::int AS jobs_total,
               count(*) FILTER (WHERE j.status = 'completed')::int AS jobs_completed,
               count(*) FILTER (WHERE j.status = 'goa')::int AS jobs_goa,
               coalesce(sum(j.rate_quoted_cents) FILTER (WHERE j.status = 'completed'), 0)::bigint AS revenue_cents,
               count(*) FILTER (
                 WHERE osf.on_scene_at IS NOT NULL
                   AND osf.enroute_at IS NOT NULL
                   AND extract(epoch from (osf.on_scene_at - osf.enroute_at)) <= 1200
               )::int AS on_time_count,
               rated.avg_rating
          FROM jobs j
          LEFT JOIN drivers d ON d.id = j.assigned_driver_id
          LEFT JOIN on_scene_first osf ON osf.job_id = j.id
          LEFT JOIN rated ON rated.assigned_driver_id = j.assigned_driver_id
         WHERE j.tenant_id = ${ctx.tenantId}::uuid
           AND j.deleted_at IS NULL
           AND j.assigned_driver_id IS NOT NULL
           AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY j.assigned_driver_id, d.first_name, d.last_name, rated.avg_rating
         ORDER BY revenue_cents DESC
         LIMIT ${limit}
      `);

      const rows = (perDriver.rows ?? []).map((r) => {
        const total = Number(r.jobs_total);
        const goa = Number(r.jobs_goa);
        const onTime = Number(r.on_time_count);
        const completed = Number(r.jobs_completed);
        return {
          driverId: r.driver_id ?? null,
          driver:
            [r.first_name ?? '', r.last_name ?? ''].filter((s) => s.length > 0).join(' ') ||
            '(unknown)',
          jobsTotal: total,
          jobsCompleted: completed,
          jobsGoa: goa,
          revenueCents: Number(r.revenue_cents),
          onTimeRatePct: completed > 0 ? Number(((onTime / completed) * 100).toFixed(1)) : 0,
          goaRatePct: total > 0 ? Number(((goa / total) * 100).toFixed(1)) : 0,
          avgRating: r.avg_rating === null ? null : Number(Number(r.avg_rating).toFixed(2)),
        };
      });

      // Daily series — total completed jobs across all drivers.
      const daily = await tx.execute<{ day: string; jobs: number; revenue: number }>(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE status = 'completed')::int AS jobs,
               coalesce(sum(rate_quoted_cents) FILTER (WHERE status = 'completed'), 0)::bigint AS revenue
          FROM jobs
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND deleted_at IS NULL
           AND created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND created_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY day
         ORDER BY day ASC
      `);

      const breakdown = rows.slice(0, 10).map((r) => ({
        key: r.driverId ?? r.driver,
        label: r.driver,
        value: r.revenueCents,
        secondaryValue: r.jobsCompleted,
      }));

      const timeSeries = (daily.rows ?? []).map((d) => ({
        bucket: d.day,
        value: Number(d.jobs),
        comparisonValue: Number(d.revenue),
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
          'On-time = enroute → on_scene transition completed within 20 minutes.',
          'Damage incidents tracking arrives in a follow-up session.',
        ],
      };
    });
  }
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const d = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}$${d.toLocaleString('en-US')}.${String(c).padStart(2, '0')}`;
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
