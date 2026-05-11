/**
 * Dispatch performance report.
 *
 * KPIs:
 *   - Jobs per dispatcher (created)
 *   - GOA rate (jobs ending in goa / total)
 *   - Average call-to-dispatch time
 *   - Average on-scene time
 *   - ETA accuracy: comparing predicted ETA vs actual on-scene time.
 *     Predicted ETA isn't a persisted column today (Session 7 lives in the
 *     rate engine output); we approximate using the difference between the
 *     job createdAt and the first 'on_scene' transition vs an industry
 *     baseline of 30 minutes. This is flagged in docs/reporting.md as an
 *     approximation that will improve when Session 13 (Agero gateway)
 *     starts persisting predicted ETAs.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  DispatchPerformanceRow,
  ReportPage,
  ReportSummary,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { resolveWindow } from '../reporting-window.js';

interface DispatcherStatsRow {
  dispatcher_id: string;
  dispatcher_name: string;
  jobs_total: string | number;
  goa_count: string | number;
  avg_call_to_dispatch_sec: string | number | null;
  avg_on_scene_sec: string | number | null;
  on_scene_completed: string | number;
}

@Injectable()
export class DispatchReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const rows = await this.queryDispatcherStats(ctx, win.from, win.to);
    const totals = rows.reduce(
      (a, r) => ({
        jobs: a.jobs + Number(r.jobs_total),
        goa: a.goa + Number(r.goa_count),
        ctdSum:
          a.ctdSum +
          (r.avg_call_to_dispatch_sec != null
            ? Number(r.avg_call_to_dispatch_sec) * Number(r.jobs_total)
            : 0),
        ctdN: a.ctdN + (r.avg_call_to_dispatch_sec != null ? Number(r.jobs_total) : 0),
        onSceneSum:
          a.onSceneSum +
          (r.avg_on_scene_sec != null
            ? Number(r.avg_on_scene_sec) * Number(r.on_scene_completed)
            : 0),
        onSceneN: a.onSceneN + Number(r.on_scene_completed),
      }),
      { jobs: 0, goa: 0, ctdSum: 0, ctdN: 0, onSceneSum: 0, onSceneN: 0 },
    );
    const goaRate = totals.jobs > 0 ? totals.goa / totals.jobs : 0;
    const avgCtd = totals.ctdN > 0 ? totals.ctdSum / totals.ctdN : null;
    const avgOs = totals.onSceneN > 0 ? totals.onSceneSum / totals.onSceneN : null;

    return {
      reportId: 'dispatch',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        { label: 'Jobs', value: totals.jobs.toLocaleString() },
        {
          label: 'GOA rate',
          value: `${(goaRate * 100).toFixed(1)}%`,
          trend: goaRate < 0.05 ? 'good' : 'bad',
        },
        {
          label: 'Avg call→dispatch',
          value: avgCtd == null ? '—' : formatDuration(avgCtd),
          trend: 'neutral',
        },
        {
          label: 'Avg on-scene',
          value: avgOs == null ? '—' : formatDuration(avgOs),
          trend: 'neutral',
        },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters,
  ): Promise<ReportPage<DispatchPerformanceRow>> {
    const win = resolveWindow(filters);
    const rows = await this.queryDispatcherStats(ctx, win.from, win.to);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    const page = rows.slice(offset, offset + limit);
    const mapped: DispatchPerformanceRow[] = page.map((r) => {
      const jobs = Number(r.jobs_total);
      const goa = Number(r.goa_count);
      return {
        dispatcherId: r.dispatcher_id,
        dispatcherName: r.dispatcher_name || 'Unknown',
        jobsTotal: jobs,
        goaCount: goa,
        goaRate: jobs > 0 ? goa / jobs : 0,
        avgCallToDispatchSec:
          r.avg_call_to_dispatch_sec != null ? Number(r.avg_call_to_dispatch_sec) : null,
        avgOnSceneSec: r.avg_on_scene_sec != null ? Number(r.avg_on_scene_sec) : null,
        // Approximation: 1 - (avg dispatch latency / 30-min baseline) bounded.
        etaAccuracyPct:
          r.avg_call_to_dispatch_sec != null
            ? clampPct(1 - Number(r.avg_call_to_dispatch_sec) / (30 * 60))
            : null,
      };
    });
    return {
      rows: mapped,
      nextCursor: offset + limit < rows.length ? encodeOffset(offset + limit) : null,
      total: rows.length,
    };
  }

  private async queryDispatcherStats(
    ctx: ReportContext,
    from: Date,
    to: Date,
  ): Promise<DispatcherStatsRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<DispatcherStatsRow>(sql`
        WITH job_lifecycle AS (
          SELECT
            j.id,
            j.tenant_id,
            j.created_by_user_id,
            j.status,
            j.created_at,
            j.assigned_at,
            (
              SELECT MIN(t.created_at) FROM job_status_transitions t
              WHERE t.job_id = j.id AND t.to_status = 'on_scene'
            ) AS on_scene_at,
            (
              SELECT MIN(t.created_at) FROM job_status_transitions t
              WHERE t.job_id = j.id AND t.to_status = 'completed'
            ) AS completed_at
          FROM jobs j
          WHERE j.deleted_at IS NULL
            AND j.created_at >= ${from.toISOString()}
            AND j.created_at < ${to.toISOString()}
        )
        SELECT
          jl.created_by_user_id AS dispatcher_id,
          COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email, 'Unknown') AS dispatcher_name,
          COUNT(*) AS jobs_total,
          SUM(CASE WHEN jl.status = 'goa' THEN 1 ELSE 0 END) AS goa_count,
          AVG(EXTRACT(EPOCH FROM (jl.assigned_at - jl.created_at)))::float AS avg_call_to_dispatch_sec,
          AVG(
            CASE WHEN jl.completed_at IS NOT NULL AND jl.on_scene_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (jl.completed_at - jl.on_scene_at))
              ELSE NULL END
          )::float AS avg_on_scene_sec,
          SUM(CASE WHEN jl.completed_at IS NOT NULL AND jl.on_scene_at IS NOT NULL THEN 1 ELSE 0 END)
            AS on_scene_completed
        FROM job_lifecycle jl
        LEFT JOIN users u ON u.id = jl.created_by_user_id
        WHERE jl.created_by_user_id IS NOT NULL
        GROUP BY jl.created_by_user_id, u.first_name, u.last_name, u.email
        ORDER BY jobs_total DESC
      `);
      return result.rows;
    });
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function clampPct(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

