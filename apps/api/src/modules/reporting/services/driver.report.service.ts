/**
 * Driver performance report.
 *
 * Drivers see only their own row — the service injects a driver_id filter
 * when ctx.role === 'driver' (matched via drivers.user_id = ctx.userId).
 *
 * Damage incidents and customer ratings: there's no damage-incident table
 * today; we approximate `damageIncidents` as the count of jobs cancelled
 * with reason mentioning 'damage'. Ratings come from tracking_links.rating.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  DriverPerformanceRow,
  ReportPage,
  ReportSummary,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { resolveWindow } from '../reporting-window.js';

interface DriverStatsRow {
  driver_id: string;
  driver_name: string;
  jobs_completed: string | number;
  revenue_cents: string | number;
  goa_count: string | number;
  damage_incidents: string | number;
  on_time_jobs: string | number;
  on_time_total: string | number;
  hours_worked: string | number | null;
  avg_rating: string | number | null;
}

@Injectable()
export class DriverReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const rows = await this.queryDriverStats(ctx, win.from, win.to);
    const totals = rows.reduce(
      (a, r) => {
        const jobs = Number(r.jobs_completed);
        return {
          drivers: a.drivers + 1,
          jobs: a.jobs + jobs,
          revenue: a.revenue + Number(r.revenue_cents),
          onTime: a.onTime + Number(r.on_time_jobs),
          onTimeTotal: a.onTimeTotal + Number(r.on_time_total),
          goa: a.goa + Number(r.goa_count),
          damage: a.damage + Number(r.damage_incidents),
          ratingSum: a.ratingSum + (r.avg_rating != null ? Number(r.avg_rating) * jobs : 0),
          ratingN: a.ratingN + (r.avg_rating != null ? jobs : 0),
        };
      },
      {
        drivers: 0,
        jobs: 0,
        revenue: 0,
        onTime: 0,
        onTimeTotal: 0,
        goa: 0,
        damage: 0,
        ratingSum: 0,
        ratingN: 0,
      },
    );
    const onTimePct = totals.onTimeTotal > 0 ? totals.onTime / totals.onTimeTotal : null;
    const avgRating = totals.ratingN > 0 ? totals.ratingSum / totals.ratingN : null;
    return {
      reportId: 'driver',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        { label: 'Active drivers', value: totals.drivers.toLocaleString() },
        { label: 'Jobs completed', value: totals.jobs.toLocaleString() },
        {
          label: 'Revenue',
          value: formatMoney(totals.revenue),
        },
        {
          label: 'On-time arrival',
          value: onTimePct == null ? '—' : `${(onTimePct * 100).toFixed(0)}%`,
          trend: onTimePct != null && onTimePct >= 0.9 ? 'good' : 'bad',
        },
        {
          label: 'Avg rating',
          value: avgRating == null ? '—' : `${avgRating.toFixed(2)} ★`,
        },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters,
  ): Promise<ReportPage<DriverPerformanceRow>> {
    const win = resolveWindow(filters);
    const rows = await this.queryDriverStats(ctx, win.from, win.to);
    const dayCount = Math.max(1, Math.round((win.to.getTime() - win.from.getTime()) / 86_400_000));
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    const page = rows.slice(offset, offset + limit);
    const mapped: DriverPerformanceRow[] = page.map((r) => {
      const jobs = Number(r.jobs_completed);
      const onTimeTotal = Number(r.on_time_total);
      const hours = r.hours_worked != null ? Number(r.hours_worked) : null;
      return {
        driverId: r.driver_id,
        driverName: r.driver_name,
        jobsCompleted: jobs,
        jobsPerDay: jobs / dayCount,
        revenueCents: Number(r.revenue_cents),
        onTimePct: onTimeTotal > 0 ? Number(r.on_time_jobs) / onTimeTotal : null,
        avgRating: r.avg_rating != null ? Number(r.avg_rating) : null,
        damageIncidents: Number(r.damage_incidents),
        goaRate: jobs > 0 ? Number(r.goa_count) / jobs : 0,
        hoursWorked: hours,
        jobsPerHour: hours && hours > 0 ? jobs / hours : null,
      };
    });
    return {
      rows: mapped,
      nextCursor: offset + limit < rows.length ? encodeOffset(offset + limit) : null,
      total: rows.length,
    };
  }

  private async queryDriverStats(
    ctx: ReportContext,
    from: Date,
    to: Date,
  ): Promise<DriverStatsRow[]> {
    // Driver role -> restrict to own driver row only.
    const isDriver = ctx.role === 'driver';
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<DriverStatsRow>(sql`
        WITH driver_jobs AS (
          SELECT
            d.id AS driver_id,
            COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), d.email, 'Unknown')
              AS driver_name,
            d.user_id,
            j.id AS job_id,
            j.status,
            j.cancelled_reason,
            j.assigned_at,
            (
              SELECT MIN(t.created_at) FROM job_status_transitions t
              WHERE t.job_id = j.id AND t.to_status = 'on_scene'
            ) AS on_scene_at,
            (
              SELECT MIN(t.created_at) FROM job_status_transitions t
              WHERE t.job_id = j.id AND t.to_status = 'completed'
            ) AS completed_at,
            COALESCE(j.rate_quoted_cents, 0) AS revenue_cents,
            j.assigned_shift_id
          FROM drivers d
          LEFT JOIN jobs j ON j.assigned_driver_id = d.id
            AND j.deleted_at IS NULL
            AND j.created_at >= ${from.toISOString()}
            AND j.created_at < ${to.toISOString()}
          WHERE d.deleted_at IS NULL
            ${isDriver ? sql`AND d.user_id = ${ctx.userId}::uuid` : sql``}
        ),
        driver_hours AS (
          SELECT
            d.id AS driver_id,
            COALESCE(SUM(
              CASE WHEN s.ended_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 3600.0
                ELSE NULL END
            ), 0)::float AS hours_worked
          FROM drivers d
          LEFT JOIN driver_shifts s ON s.driver_id = d.id
            AND s.started_at >= ${from.toISOString()}
            AND s.started_at < ${to.toISOString()}
            AND s.deleted_at IS NULL
          WHERE d.deleted_at IS NULL
            ${isDriver ? sql`AND d.user_id = ${ctx.userId}::uuid` : sql``}
          GROUP BY d.id
        ),
        driver_ratings AS (
          SELECT
            d.id AS driver_id,
            AVG(tl.stars)::float AS avg_rating
          FROM drivers d
          LEFT JOIN jobs j ON j.assigned_driver_id = d.id
            AND j.deleted_at IS NULL
            AND j.created_at >= ${from.toISOString()}
            AND j.created_at < ${to.toISOString()}
          LEFT JOIN job_ratings tl ON tl.job_id = j.id
          WHERE d.deleted_at IS NULL
            ${isDriver ? sql`AND d.user_id = ${ctx.userId}::uuid` : sql``}
          GROUP BY d.id
        )
        SELECT
          dj.driver_id,
          MAX(dj.driver_name) AS driver_name,
          SUM(CASE WHEN dj.status = 'completed' THEN 1 ELSE 0 END) AS jobs_completed,
          SUM(CASE WHEN dj.status = 'completed' THEN dj.revenue_cents ELSE 0 END)::bigint
            AS revenue_cents,
          SUM(CASE WHEN dj.status = 'goa' THEN 1 ELSE 0 END) AS goa_count,
          SUM(
            CASE WHEN dj.cancelled_reason IS NOT NULL
              AND LOWER(dj.cancelled_reason) LIKE '%damage%' THEN 1 ELSE 0 END
          ) AS damage_incidents,
          SUM(
            CASE WHEN dj.on_scene_at IS NOT NULL
              AND dj.assigned_at IS NOT NULL
              AND EXTRACT(EPOCH FROM (dj.on_scene_at - dj.assigned_at)) <= 30 * 60
              THEN 1 ELSE 0 END
          ) AS on_time_jobs,
          SUM(CASE WHEN dj.on_scene_at IS NOT NULL THEN 1 ELSE 0 END) AS on_time_total,
          MAX(dh.hours_worked) AS hours_worked,
          MAX(dr.avg_rating) AS avg_rating
        FROM driver_jobs dj
        LEFT JOIN driver_hours dh ON dh.driver_id = dj.driver_id
        LEFT JOIN driver_ratings dr ON dr.driver_id = dj.driver_id
        GROUP BY dj.driver_id
        ORDER BY jobs_completed DESC
      `);
      return result.rows;
    });
  }
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
