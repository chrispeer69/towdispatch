/**
 * Profit & Loss report.
 *
 * Revenue per dimension minus three modeled costs:
 *   - Driver commission — fallback flat rate of 25% of gross when no
 *     commission_rules row exists (Session 14 introduces the table but the
 *     rule shape is intentionally undefined for now). Documented.
 *   - Fuel allocation — $/mile × trip distance approximation. We don't have
 *     per-trip miles persisted yet, so the report uses a tenant-level monthly
 *     fuel-spend setting if present in tenants.settings.fuel_monthly_cents.
 *     Allocated proportionally to completed jobs in the window.
 *   - Truck depreciation — straight-line over 5 years, taken from
 *     tenants.settings.truck_depreciation_monthly_cents.
 *   - Motor club fees — invoice_taxes sum for invoices flagged motor_club_submission.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  PnlDimension,
  PnlRow,
  ReportPage,
  ReportSummary,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { resolveWindow } from '../reporting-window.js';

interface PnlSourceRow {
  ref_id: string | null;
  label: string;
  jobs_count: string | number;
  revenue_cents: string | number;
  motor_club_fees_cents: string | number;
}

interface TenantSettingsRow {
  fuel_monthly_cents: number | null;
  truck_depreciation_monthly_cents: number | null;
  commission_default_pct: number | null;
}

const DEFAULT_COMMISSION_PCT = 0.25;

@Injectable()
export class PnlReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const settings = await this.tenantSettings(ctx);
    const rows = await this.queryByDimension(ctx, win.from, win.to, 'job');
    const totals = this.applyCosts(rows, settings, win.from, win.to);
    const sumRev = totals.reduce((s, r) => s + r.revenueCents, 0);
    const sumNet = totals.reduce((s, r) => s + r.netCents, 0);
    const sumCom = totals.reduce((s, r) => s + r.driverCommissionCents, 0);
    return {
      reportId: 'pnl',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        { label: 'Revenue', value: formatMoney(sumRev) },
        {
          label: 'Net profit',
          value: formatMoney(sumNet),
          trend: sumNet > 0 ? 'good' : 'bad',
        },
        {
          label: 'Margin',
          value: sumRev > 0 ? `${((sumNet / sumRev) * 100).toFixed(1)}%` : '—',
        },
        { label: 'Commissions', value: formatMoney(sumCom) },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters & { dimension?: PnlDimension },
  ): Promise<ReportPage<PnlRow>> {
    const win = resolveWindow(filters);
    const settings = await this.tenantSettings(ctx);
    const dimension = filters.dimension ?? 'job';
    const rows = await this.queryByDimension(ctx, win.from, win.to, dimension);
    const decorated = this.applyCosts(rows, settings, win.from, win.to);
    decorated.sort((a, b) => b.revenueCents - a.revenueCents);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    return {
      rows: decorated.slice(offset, offset + limit),
      nextCursor: offset + limit < decorated.length ? encodeOffset(offset + limit) : null,
      total: decorated.length,
    };
  }

  private applyCosts(
    rows: PnlSourceRow[],
    settings: TenantSettingsRow,
    from: Date,
    to: Date,
  ): PnlRow[] {
    const totalJobs = rows.reduce((s, r) => s + Number(r.jobs_count), 0);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
    const monthFactor = days / 30;
    const fuelMonthly = settings.fuel_monthly_cents ?? 0;
    const deprecMonthly = settings.truck_depreciation_monthly_cents ?? 0;
    const commissionPct = settings.commission_default_pct ?? DEFAULT_COMMISSION_PCT;
    return rows.map((r) => {
      const jobs = Number(r.jobs_count);
      const rev = Number(r.revenue_cents);
      const driverCommission = Math.round(rev * commissionPct);
      const fuelShare = totalJobs > 0 ? Math.round((fuelMonthly * monthFactor * jobs) / totalJobs) : 0;
      const deprecShare =
        totalJobs > 0 ? Math.round((deprecMonthly * monthFactor * jobs) / totalJobs) : 0;
      const motorClub = Number(r.motor_club_fees_cents);
      const net = rev - driverCommission - fuelShare - deprecShare - motorClub;
      return {
        dimensionKey: r.ref_id ?? r.label,
        label: r.label,
        revenueCents: rev,
        driverCommissionCents: driverCommission,
        fuelCostCents: fuelShare,
        truckDepreciationCents: deprecShare,
        motorClubFeesCents: motorClub,
        netCents: net,
      };
    });
  }

  private async tenantSettings(ctx: ReportContext): Promise<TenantSettingsRow> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<{ settings: Record<string, unknown> | null }>(sql`
        SELECT settings FROM tenants WHERE id = ${ctx.tenantId}::uuid
      `);
      const row = result.rows[0];
      const s = (row?.settings ?? {}) as Record<string, unknown>;
      return {
        fuel_monthly_cents: numOrNull(s.fuel_monthly_cents),
        truck_depreciation_monthly_cents: numOrNull(s.truck_depreciation_monthly_cents),
        commission_default_pct: numOrNull(s.commission_default_pct),
      };
    });
  }

  private async queryByDimension(
    ctx: ReportContext,
    from: Date,
    to: Date,
    dimension: PnlDimension,
  ): Promise<PnlSourceRow[]> {
    return this.read.run(ctx, async (db) => {
      const isMotorClub = sql`(i.invoice_type = 'motor_club_submission')`;
      switch (dimension) {
        case 'job': {
          const result = await db.execute<PnlSourceRow>(sql`
            SELECT
              j.id::text AS ref_id,
              j.job_number AS label,
              1 AS jobs_count,
              COALESCE(SUM(i.total_cents), j.rate_quoted_cents)::bigint AS revenue_cents,
              COALESCE(SUM(CASE WHEN ${isMotorClub} THEN i.total_cents * 0.10 ELSE 0 END), 0)::bigint
                AS motor_club_fees_cents
            FROM jobs j
            LEFT JOIN invoices i ON i.job_id = j.id
              AND i.deleted_at IS NULL
              AND i.status <> 'void'
            WHERE j.deleted_at IS NULL
              AND j.status = 'completed'
              AND j.created_at >= ${from.toISOString()}
              AND j.created_at < ${to.toISOString()}
            GROUP BY j.id, j.job_number, j.rate_quoted_cents
            ORDER BY revenue_cents DESC NULLS LAST
            LIMIT 500
          `);
          return result.rows;
        }
        case 'truck': {
          const result = await db.execute<PnlSourceRow>(sql`
            SELECT
              t.id::text AS ref_id,
              COALESCE(t.unit_number, t.vin, t.id::text) AS label,
              COUNT(j.id) AS jobs_count,
              COALESCE(SUM(i.total_cents), 0)::bigint AS revenue_cents,
              COALESCE(SUM(CASE WHEN ${isMotorClub} THEN i.total_cents * 0.10 ELSE 0 END), 0)::bigint
                AS motor_club_fees_cents
            FROM trucks t
            LEFT JOIN jobs j ON j.assigned_truck_id = t.id
              AND j.deleted_at IS NULL
              AND j.status = 'completed'
              AND j.created_at >= ${from.toISOString()}
              AND j.created_at < ${to.toISOString()}
            LEFT JOIN invoices i ON i.job_id = j.id
              AND i.deleted_at IS NULL
              AND i.status <> 'void'
            WHERE t.deleted_at IS NULL
            GROUP BY t.id, t.unit_number, t.vin
            ORDER BY revenue_cents DESC
          `);
          return result.rows;
        }
        case 'driver': {
          const result = await db.execute<PnlSourceRow>(sql`
            SELECT
              d.id::text AS ref_id,
              COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), 'Driver') AS label,
              COUNT(j.id) AS jobs_count,
              COALESCE(SUM(i.total_cents), 0)::bigint AS revenue_cents,
              COALESCE(SUM(CASE WHEN ${isMotorClub} THEN i.total_cents * 0.10 ELSE 0 END), 0)::bigint
                AS motor_club_fees_cents
            FROM drivers d
            LEFT JOIN jobs j ON j.assigned_driver_id = d.id
              AND j.deleted_at IS NULL
              AND j.status = 'completed'
              AND j.created_at >= ${from.toISOString()}
              AND j.created_at < ${to.toISOString()}
            LEFT JOIN invoices i ON i.job_id = j.id
              AND i.deleted_at IS NULL
              AND i.status <> 'void'
            WHERE d.deleted_at IS NULL
            GROUP BY d.id, d.first_name, d.last_name
            ORDER BY revenue_cents DESC
          `);
          return result.rows;
        }
        case 'yard': {
          // Yards are a Session 9 stub; we group by drivers.assigned_yard_id.
          const result = await db.execute<PnlSourceRow>(sql`
            SELECT
              COALESCE(d.assigned_yard_id::text, 'unassigned') AS ref_id,
              COALESCE(d.assigned_yard_id::text, 'Unassigned') AS label,
              COUNT(j.id) AS jobs_count,
              COALESCE(SUM(i.total_cents), 0)::bigint AS revenue_cents,
              COALESCE(SUM(CASE WHEN ${isMotorClub} THEN i.total_cents * 0.10 ELSE 0 END), 0)::bigint
                AS motor_club_fees_cents
            FROM drivers d
            LEFT JOIN jobs j ON j.assigned_driver_id = d.id
              AND j.deleted_at IS NULL
              AND j.status = 'completed'
              AND j.created_at >= ${from.toISOString()}
              AND j.created_at < ${to.toISOString()}
            LEFT JOIN invoices i ON i.job_id = j.id
              AND i.deleted_at IS NULL
              AND i.status <> 'void'
            WHERE d.deleted_at IS NULL
            GROUP BY d.assigned_yard_id
            ORDER BY revenue_cents DESC
          `);
          return result.rows;
        }
      }
    });
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
