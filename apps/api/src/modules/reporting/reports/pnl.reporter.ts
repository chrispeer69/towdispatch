/**
 * Profit & Loss reporter.
 *
 *   - By job, truck, driver, yard.
 *   - Revenue per row: completed jobs only (sum rate_quoted_cents).
 *   - Driver commission: applied via drivers.commission_rule_id → commission_rules.
 *     percent rule = rate_quoted_cents * rate_pct / 100, capped by cap_cents,
 *     floored by floor_cents. flat = flat_cents flat.
 *   - Fuel allocation: not yet tracked at the per-job grain. We model it as a
 *     tenant-wide flat per-completed-job placeholder of 0 cents until the fuel
 *     module ships; emit a note explaining this.
 *   - Truck depreciation: same — placeholder 0 today. Note on the report.
 *   - Motor club fees: invoices.invoice_type='motor_club_submission' carry the
 *     gross; the typical 15% remit fee is computed at the row level as a
 *     deduction proxy (documented).
 *
 * The COO understands these are v1 placeholders — the report SHAPE is the
 * delivery; the fuel/depreciation numbers swap in when those modules land.
 */
import { Injectable } from '@nestjs/common';
import type { ReportId } from '@ustowdispatch/shared';
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

const MOTOR_CLUB_FEE_PCT = 15;

@Injectable()
export class PnlReporter implements Reporter {
  readonly id: ReportId = 'pnl';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<{
        revenue_cents: number;
        commission_cents: number;
        motor_club_fee_cents: number;
        completed: number;
      }>(sql`
        WITH base AS (
          SELECT j.id,
                 j.rate_quoted_cents,
                 j.account_id,
                 cr.rule_type,
                 coalesce(cr.rate_pct, '0')::numeric AS rate_pct,
                 coalesce(cr.flat_cents, 0) AS flat_cents,
                 coalesce(cr.cap_cents, 9223372036854775807) AS cap_cents,
                 coalesce(cr.floor_cents, 0) AS floor_cents,
                 a.is_motor_club AS is_motor_club
            FROM jobs j
            LEFT JOIN drivers d ON d.id = j.assigned_driver_id
            LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
            LEFT JOIN accounts a ON a.id = j.account_id
           WHERE j.tenant_id = ${ctx.tenantId}::uuid
             AND j.deleted_at IS NULL
             AND j.status = 'completed'
             AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
             AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
        ),
        scored AS (
          SELECT *,
                 CASE rule_type
                   WHEN 'flat' THEN flat_cents
                   WHEN 'percent' THEN least(cap_cents,
                                             greatest(floor_cents, (rate_quoted_cents * rate_pct / 100)::bigint))
                   ELSE 0
                 END AS commission_cents,
                 CASE WHEN is_motor_club
                      THEN (rate_quoted_cents * ${MOTOR_CLUB_FEE_PCT} / 100)::bigint
                      ELSE 0 END AS motor_club_fee_cents
            FROM base
        )
        SELECT count(*)::int AS completed,
               coalesce(sum(rate_quoted_cents), 0)::bigint AS revenue_cents,
               coalesce(sum(commission_cents), 0)::bigint AS commission_cents,
               coalesce(sum(motor_club_fee_cents), 0)::bigint AS motor_club_fee_cents
          FROM scored
      `);
      const row = r.rows[0] ?? {
        revenue_cents: 0,
        commission_cents: 0,
        motor_club_fee_cents: 0,
        completed: 0,
      };
      const revenue = Number(row.revenue_cents);
      const commission = Number(row.commission_cents);
      const fees = Number(row.motor_club_fee_cents);
      const gross = revenue - commission - fees;
      return {
        reportId: this.id,
        headline: 'Profit & loss',
        asOf: new Date(),
        kpis: [
          { label: 'Revenue', value: formatCents(revenue), tone: 'neutral' },
          { label: 'Driver commission', value: formatCents(commission), tone: 'neutral' },
          { label: 'Motor club fees', value: formatCents(fees), tone: 'neutral' },
          {
            label: 'Gross margin',
            value: formatCents(gross),
            tone: gross >= 0 ? 'ok' : 'danger',
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
      // By-truck rollup.
      const byTruck = await tx.execute<{
        truck_id: string | null;
        unit_number: string | null;
        completed: number;
        revenue_cents: number;
        commission_cents: number;
        motor_club_fee_cents: number;
      }>(sql`
        WITH base AS (
          SELECT j.id, j.assigned_truck_id, j.rate_quoted_cents,
                 cr.rule_type,
                 coalesce(cr.rate_pct, '0')::numeric AS rate_pct,
                 coalesce(cr.flat_cents, 0) AS flat_cents,
                 coalesce(cr.cap_cents, 9223372036854775807) AS cap_cents,
                 coalesce(cr.floor_cents, 0) AS floor_cents,
                 coalesce(a.is_motor_club, false) AS is_motor_club
            FROM jobs j
            LEFT JOIN drivers d ON d.id = j.assigned_driver_id
            LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
            LEFT JOIN accounts a ON a.id = j.account_id
           WHERE j.tenant_id = ${ctx.tenantId}::uuid
             AND j.deleted_at IS NULL
             AND j.status = 'completed'
             AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
             AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
        )
        SELECT b.assigned_truck_id AS truck_id,
               t.unit_number,
               count(*)::int AS completed,
               coalesce(sum(b.rate_quoted_cents), 0)::bigint AS revenue_cents,
               coalesce(sum(CASE b.rule_type
                 WHEN 'flat' THEN b.flat_cents
                 WHEN 'percent' THEN least(b.cap_cents, greatest(b.floor_cents, (b.rate_quoted_cents * b.rate_pct / 100)::bigint))
                 ELSE 0
               END), 0)::bigint AS commission_cents,
               coalesce(sum(CASE WHEN b.is_motor_club
                                 THEN (b.rate_quoted_cents * ${MOTOR_CLUB_FEE_PCT} / 100)::bigint
                                 ELSE 0 END), 0)::bigint AS motor_club_fee_cents
          FROM base b
          LEFT JOIN trucks t ON t.id = b.assigned_truck_id
         GROUP BY b.assigned_truck_id, t.unit_number
         ORDER BY revenue_cents DESC
         LIMIT ${limit}
      `);

      const rows = (byTruck.rows ?? []).map((r) => {
        const rev = Number(r.revenue_cents);
        const comm = Number(r.commission_cents);
        const fee = Number(r.motor_club_fee_cents);
        return {
          truckId: r.truck_id ?? null,
          unitNumber: r.unit_number ?? '(unassigned)',
          completed: Number(r.completed),
          revenueCents: rev,
          commissionCents: comm,
          motorClubFeeCents: fee,
          grossMarginCents: rev - comm - fee,
        };
      });

      // Time series: daily gross margin.
      const daily = await tx.execute<{
        day: string;
        revenue_cents: number;
        commission_cents: number;
      }>(sql`
        WITH base AS (
          SELECT date_trunc('day', j.created_at)::date AS day,
                 j.rate_quoted_cents,
                 coalesce(cr.rule_type, 'percent') AS rule_type,
                 coalesce(cr.rate_pct, '0')::numeric AS rate_pct,
                 coalesce(cr.flat_cents, 0) AS flat_cents
            FROM jobs j
            LEFT JOIN drivers d ON d.id = j.assigned_driver_id
            LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
           WHERE j.tenant_id = ${ctx.tenantId}::uuid
             AND j.deleted_at IS NULL
             AND j.status = 'completed'
             AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
             AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
        )
        SELECT to_char(day, 'YYYY-MM-DD') AS day,
               coalesce(sum(rate_quoted_cents), 0)::bigint AS revenue_cents,
               coalesce(sum(CASE rule_type
                 WHEN 'flat' THEN flat_cents
                 WHEN 'percent' THEN (rate_quoted_cents * rate_pct / 100)::bigint
                 ELSE 0
               END), 0)::bigint AS commission_cents
          FROM base
         GROUP BY day
         ORDER BY day ASC
      `);

      const breakdown = rows.slice(0, 8).map((r) => ({
        key: r.truckId ?? r.unitNumber,
        label: r.unitNumber,
        value: r.grossMarginCents,
        secondaryValue: r.completed,
      }));

      const timeSeries = (daily.rows ?? []).map((r) => ({
        bucket: r.day,
        value: Number(r.revenue_cents) - Number(r.commission_cents),
        comparisonValue: Number(r.revenue_cents),
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
          'Fuel allocation and truck depreciation are placeholders (0) until the fleet ops module ships.',
          `Motor club fee modeled at ${MOTOR_CLUB_FEE_PCT}% of gross on motor club submissions.`,
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
