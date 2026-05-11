/**
 * Commission report.
 *
 * Two views:
 *   - Pay-period summary (one row per (driver, pay_period_key))
 *   - Per-job audit trail (drill-in)
 *
 * No commission_rules table exists yet; the report uses a flat fall-back
 * percentage from tenants.settings.commission_default_pct (default 25%) and
 * a flat multiplier of 1.0. Tomorrow when the rules table ships, this
 * service is the only place that needs to learn the new shape.
 *
 * Pay period is monthly by default; weekly is selectable via filters.granularity.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommissionAuditRow,
  CommissionLineRow,
  CommonReportFilters,
  ReportPage,
  ReportSummary,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { resolveWindow } from '../reporting-window.js';

const DEFAULT_PCT = 0.25;

interface PerJobRow {
  job_id: string;
  job_number: string;
  service_type: string;
  driver_id: string;
  driver_name: string;
  completed_at: string | null;
  revenue_cents: string | number;
}

@Injectable()
export class CommissionReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const pct = await this.commissionPct(ctx);
    const jobs = await this.queryJobs(ctx, win.from, win.to);
    const totals = jobs.reduce(
      (a, j) => {
        const rev = Number(j.revenue_cents);
        return { revenue: a.revenue + rev, commission: a.commission + Math.round(rev * pct) };
      },
      { revenue: 0, commission: 0 },
    );
    return {
      reportId: 'commission',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        { label: 'Gross revenue', value: formatMoney(totals.revenue) },
        { label: 'Total commission', value: formatMoney(totals.commission) },
        { label: 'Effective rate', value: `${(pct * 100).toFixed(0)}%` },
        { label: 'Eligible jobs', value: jobs.length.toLocaleString() },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters,
  ): Promise<ReportPage<CommissionLineRow>> {
    const win = resolveWindow(filters);
    const pct = await this.commissionPct(ctx);
    const jobs = await this.queryJobs(ctx, win.from, win.to);
    const cadence: 'weekly' | 'monthly' = filters.granularity === 'week' ? 'weekly' : 'monthly';
    const byPeriod = new Map<string, CommissionLineRow>();
    for (const j of jobs) {
      const periodKey = periodOf(j.completed_at ?? j.completed_at, cadence);
      const key = `${j.driver_id}|${periodKey}`;
      const existing =
        byPeriod.get(key) ??
        ({
          driverId: j.driver_id,
          driverName: j.driver_name,
          payPeriodKey: periodKey,
          jobsCount: 0,
          grossRevenueCents: 0,
          commissionBaseCents: 0,
          multiplier: 1,
          bonusCents: 0,
          deductionCents: 0,
          netCents: 0,
        } satisfies CommissionLineRow);
      const rev = Number(j.revenue_cents);
      existing.jobsCount += 1;
      existing.grossRevenueCents += rev;
      existing.commissionBaseCents += Math.round(rev * pct);
      existing.netCents += Math.round(rev * pct);
      byPeriod.set(key, existing);
    }
    const rows = Array.from(byPeriod.values()).sort((a, b) =>
      b.payPeriodKey.localeCompare(a.payPeriodKey) || b.netCents - a.netCents,
    );
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    return {
      rows: rows.slice(offset, offset + limit),
      nextCursor: offset + limit < rows.length ? encodeOffset(offset + limit) : null,
      total: rows.length,
    };
  }

  async audit(
    ctx: ReportContext,
    filters: CommonReportFilters & { driverId?: string },
  ): Promise<ReportPage<CommissionAuditRow>> {
    const win = resolveWindow(filters);
    const pct = await this.commissionPct(ctx);
    const jobs = await this.queryJobs(ctx, win.from, win.to, filters.driverId);
    const rows: CommissionAuditRow[] = jobs.map((j) => {
      const rev = Number(j.revenue_cents);
      return {
        jobId: j.job_id,
        jobNumber: j.job_number,
        serviceType: j.service_type,
        completedAt: j.completed_at,
        revenueCents: rev,
        rate: pct,
        base: 'gross',
        multiplier: 1,
        bonusCents: 0,
        deductionCents: 0,
        netCents: Math.round(rev * pct),
      };
    });
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    return {
      rows: rows.slice(offset, offset + limit),
      nextCursor: offset + limit < rows.length ? encodeOffset(offset + limit) : null,
      total: rows.length,
    };
  }

  private async commissionPct(ctx: ReportContext): Promise<number> {
    return this.read.run(ctx, async (db) => {
      const r = await db.execute<{ settings: Record<string, unknown> | null }>(sql`
        SELECT settings FROM tenants WHERE id = ${ctx.tenantId}::uuid
      `);
      const s = (r.rows[0]?.settings ?? {}) as Record<string, unknown>;
      const v = Number(s.commission_default_pct);
      return Number.isFinite(v) && v > 0 ? v : DEFAULT_PCT;
    });
  }

  private async queryJobs(
    ctx: ReportContext,
    from: Date,
    to: Date,
    driverId?: string,
  ): Promise<PerJobRow[]> {
    const isDriver = ctx.role === 'driver';
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<PerJobRow>(sql`
        SELECT
          j.id::text AS job_id,
          j.job_number,
          j.service_type,
          j.assigned_driver_id::text AS driver_id,
          COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), 'Driver') AS driver_name,
          (
            SELECT MIN(t.created_at)::text FROM job_status_transitions t
            WHERE t.job_id = j.id AND t.to_status = 'completed'
          ) AS completed_at,
          COALESCE((
            SELECT SUM(i.total_cents)::bigint FROM invoices i
            WHERE i.job_id = j.id
              AND i.deleted_at IS NULL
              AND i.status <> 'void'
          ), j.rate_quoted_cents) AS revenue_cents
        FROM jobs j
        LEFT JOIN drivers d ON d.id = j.assigned_driver_id
        WHERE j.deleted_at IS NULL
          AND j.status = 'completed'
          AND j.assigned_driver_id IS NOT NULL
          AND j.created_at >= ${from.toISOString()}
          AND j.created_at < ${to.toISOString()}
          ${driverId ? sql`AND j.assigned_driver_id = ${driverId}::uuid` : sql``}
          ${isDriver ? sql`AND d.user_id = ${ctx.userId}::uuid` : sql``}
        ORDER BY j.created_at DESC
      `);
      return result.rows;
    });
  }
}

function periodOf(timestamp: string | null, cadence: 'weekly' | 'monthly'): string {
  if (!timestamp) return 'no-date';
  const d = new Date(timestamp);
  if (cadence === 'monthly') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  // weekly — start of ISO week
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum);
  return tmp.toISOString().slice(0, 10);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
