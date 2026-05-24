/**
 * Commission reporter.
 *
 * Per-driver / per-pay-period commission with full per-job audit trail:
 *   - job_number, completed_at, customer / account
 *   - base = rate_quoted_cents
 *   - rate / multiplier — surfaced from commission_rules
 *   - deductions (motor_club_fee_cents passthrough)
 *   - net_to_driver (clamped to [floor, cap] for percent rules)
 *
 * The summary KPIs roll up to the current pay period defined as the trailing
 * 14 days from toDate (a sensible default — most operators run bi-weekly).
 * filters.fromDate/toDate override this.
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

@Injectable()
export class CommissionReporter implements Reporter {
  readonly id: ReportId = 'commission';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<{
        completed: number;
        revenue_cents: number;
        commission_cents: number;
        active_drivers: number;
      }>(sql`
        WITH base AS (
          SELECT j.id, j.rate_quoted_cents, d.id AS driver_id,
                 cr.rule_type,
                 coalesce(cr.rate_pct, '0')::numeric AS rate_pct,
                 coalesce(cr.flat_cents, 0) AS flat_cents,
                 coalesce(cr.cap_cents, 9223372036854775807) AS cap_cents,
                 coalesce(cr.floor_cents, 0) AS floor_cents
            FROM jobs j
            JOIN drivers d ON d.id = j.assigned_driver_id
            LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
           WHERE j.tenant_id = ${ctx.tenantId}::uuid
             AND j.deleted_at IS NULL
             AND j.status = 'completed'
             AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
             AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
        )
        SELECT count(*)::int AS completed,
               count(DISTINCT driver_id)::int AS active_drivers,
               coalesce(sum(rate_quoted_cents), 0)::bigint AS revenue_cents,
               coalesce(sum(CASE rule_type
                 WHEN 'flat' THEN flat_cents
                 WHEN 'percent' THEN least(cap_cents, greatest(floor_cents, (rate_quoted_cents * rate_pct / 100)::bigint))
                 ELSE 0
               END), 0)::bigint AS commission_cents
          FROM base
      `);
      const row = r.rows[0] ?? {
        completed: 0,
        revenue_cents: 0,
        commission_cents: 0,
        active_drivers: 0,
      };
      return {
        reportId: this.id,
        headline: 'Commission',
        asOf: new Date(),
        kpis: [
          { label: 'Drivers paid', value: Number(row.active_drivers), tone: 'neutral' },
          { label: 'Jobs', value: Number(row.completed), tone: 'neutral' },
          { label: 'Revenue base', value: formatCents(Number(row.revenue_cents)), tone: 'neutral' },
          {
            label: 'Commission payable',
            value: formatCents(Number(row.commission_cents)),
            tone: 'neutral',
          },
        ],
      };
    });
  }

  async detail(ctx: AuthCtx, filters: ReportFilters): Promise<ReportDetail> {
    const summary = await this.summary(ctx, filters);
    const w = resolveWindow(filters);
    const limit = filters.limit ?? 200;

    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      // Per-job audit trail.
      const auditRows = await tx.execute<{
        job_id: string;
        job_number: string;
        completed_at: string;
        driver_id: string | null;
        driver_name: string | null;
        customer_name: string | null;
        account_name: string | null;
        base_cents: number;
        rule_type: string | null;
        rate_pct: string | null;
        flat_cents: number;
        cap_cents: number;
        floor_cents: number;
        commission_cents: number;
      }>(sql`
        SELECT j.id AS job_id,
               j.job_number,
               j.updated_at AS completed_at,
               d.id AS driver_id,
               (coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''))::text AS driver_name,
               c.name AS customer_name,
               a.name AS account_name,
               j.rate_quoted_cents AS base_cents,
               cr.rule_type,
               coalesce(cr.rate_pct::text, '0') AS rate_pct,
               coalesce(cr.flat_cents, 0) AS flat_cents,
               coalesce(cr.cap_cents, 9223372036854775807) AS cap_cents,
               coalesce(cr.floor_cents, 0) AS floor_cents,
               CASE coalesce(cr.rule_type, 'percent')
                 WHEN 'flat' THEN coalesce(cr.flat_cents, 0)
                 WHEN 'percent' THEN least(coalesce(cr.cap_cents, 9223372036854775807),
                                           greatest(coalesce(cr.floor_cents, 0),
                                                   (j.rate_quoted_cents * coalesce(cr.rate_pct, '0')::numeric / 100)::bigint))
                 ELSE 0
               END AS commission_cents
          FROM jobs j
          LEFT JOIN drivers d ON d.id = j.assigned_driver_id
          LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
          LEFT JOIN customers c ON c.id = j.customer_id
          LEFT JOIN accounts a ON a.id = j.account_id
         WHERE j.tenant_id = ${ctx.tenantId}::uuid
           AND j.deleted_at IS NULL
           AND j.status = 'completed'
           AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
         ORDER BY j.updated_at DESC
         LIMIT ${limit}
      `);

      const rows = (auditRows.rows ?? []).map((r) => ({
        jobId: r.job_id,
        jobNumber: r.job_number,
        completedAt:
          typeof r.completed_at === 'string'
            ? r.completed_at
            : new Date(r.completed_at).toISOString(),
        driverId: r.driver_id ?? null,
        driver: (r.driver_name ?? '').trim() || '(unassigned)',
        customer: r.customer_name ?? '(none)',
        account: r.account_name ?? '(cash)',
        baseCents: Number(r.base_cents),
        ruleType: r.rule_type ?? 'none',
        ratePct: r.rate_pct ?? '0',
        flatCents: Number(r.flat_cents),
        capCents: Number(r.cap_cents) >= 9_000_000_000_000_000_000 ? null : Number(r.cap_cents),
        floorCents: Number(r.floor_cents),
        commissionCents: Number(r.commission_cents),
      }));

      // Per-driver rollup (breakdown chart).
      const breakdownMap = new Map<string, { label: string; value: number }>();
      for (const row of rows) {
        const key = row.driverId ?? row.driver;
        const cur = breakdownMap.get(key) ?? { label: row.driver, value: 0 };
        cur.value += row.commissionCents;
        breakdownMap.set(key, cur);
      }
      const breakdown = Array.from(breakdownMap.entries())
        .map(([key, v]) => ({ key, label: v.label, value: v.value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);

      // Daily commission accrual chart.
      const daily = await tx.execute<{ day: string; commission_cents: number }>(sql`
        WITH base AS (
          SELECT date_trunc('day', j.created_at)::date AS day,
                 j.rate_quoted_cents,
                 coalesce(cr.rule_type, 'percent') AS rule_type,
                 coalesce(cr.rate_pct, '0')::numeric AS rate_pct,
                 coalesce(cr.flat_cents, 0) AS flat_cents
            FROM jobs j
            JOIN drivers d ON d.id = j.assigned_driver_id
            LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
           WHERE j.tenant_id = ${ctx.tenantId}::uuid
             AND j.deleted_at IS NULL
             AND j.status = 'completed'
             AND j.created_at >= ${w.fromDate.toISOString()}::timestamptz
             AND j.created_at <= ${w.toDate.toISOString()}::timestamptz
        )
        SELECT to_char(day, 'YYYY-MM-DD') AS day,
               coalesce(sum(CASE rule_type
                 WHEN 'flat' THEN flat_cents
                 WHEN 'percent' THEN (rate_quoted_cents * rate_pct / 100)::bigint
                 ELSE 0
               END), 0)::bigint AS commission_cents
          FROM base
         GROUP BY day
         ORDER BY day ASC
      `);

      const timeSeries = (daily.rows ?? []).map((r) => ({
        bucket: r.day,
        value: Number(r.commission_cents),
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
          'Commission is computed per job at report time from the driver’s current rule.',
          'Drivers with no rule attached show ruleType=none and commission=0.',
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
