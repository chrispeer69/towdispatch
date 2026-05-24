/**
 * Storage & Impound reporter.
 *
 *   - Yard utilization %         (active recurring_billing_schedules / yard capacity).
 *                                Capacity isn't yet on a yard table; until that
 *                                ships we treat utilization as a count of active
 *                                schedules and surface a note.
 *   - Days-in-yard histogram     (now() - started_at on active schedules)
 *   - Projected lien revenue     (active schedules × daily_rate_cents × days-to-lien,
 *                                using 30 days as the v1 default)
 *   - A/R aging on storage fees  (invoices.invoice_type='recurring_storage' bucketed)
 *   - Oldest vehicles list       (active schedules ordered by started_at asc)
 */
import { Injectable } from '@nestjs/common';
import type { ReportId } from '@ustowdispatch/shared';
import { sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type {
  AuthCtx,
  ReportDetail,
  ReportFilters,
  ReportSummary,
  Reporter,
} from '../reporting.types.js';

const DAILY_LIEN_DAYS = 30;

@Injectable()
export class StorageReporter implements Reporter {
  readonly id: ReportId = 'storage';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, _filters: ReportFilters): Promise<ReportSummary> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<{
        active_count: number;
        avg_days: number | null;
        projected_lien_cents: number;
        ar_outstanding_cents: number;
      }>(sql`
        WITH active AS (
          SELECT *, extract(epoch from (now() - started_at)) / 86400 AS days_in_yard
            FROM recurring_billing_schedules
           WHERE tenant_id = ${ctx.tenantId}::uuid
             AND deleted_at IS NULL
             AND ended_at IS NULL
        )
        SELECT count(*)::int AS active_count,
               coalesce(avg(days_in_yard)::float8, NULL) AS avg_days,
               coalesce(sum(daily_rate_cents * greatest(0, ${DAILY_LIEN_DAYS} - floor(days_in_yard))), 0)::bigint AS projected_lien_cents,
               (SELECT coalesce(sum(balance_cents), 0)::bigint
                  FROM invoices
                 WHERE tenant_id = ${ctx.tenantId}::uuid
                   AND deleted_at IS NULL
                   AND status <> 'void'
                   AND invoice_type = 'recurring_storage') AS ar_outstanding_cents
          FROM active
      `);
      const row = r.rows[0] ?? {
        active_count: 0,
        avg_days: null,
        projected_lien_cents: 0,
        ar_outstanding_cents: 0,
      };
      return {
        reportId: this.id,
        headline: 'Storage & impound',
        asOf: new Date(),
        kpis: [
          {
            label: 'Vehicles in yard',
            value: Number(row.active_count),
            tone: 'neutral',
          },
          {
            label: 'Avg days in yard',
            value: row.avg_days === null ? '—' : Number(row.avg_days).toFixed(1),
            tone: row.avg_days === null ? 'neutral' : Number(row.avg_days) > 21 ? 'warn' : 'ok',
          },
          {
            label: 'Projected lien revenue',
            value: formatCents(Number(row.projected_lien_cents)),
            tone: 'neutral',
          },
          {
            label: 'Storage A/R',
            value: formatCents(Number(row.ar_outstanding_cents)),
            tone: Number(row.ar_outstanding_cents) > 0 ? 'warn' : 'ok',
          },
        ],
      };
    });
  }

  async detail(ctx: AuthCtx, filters: ReportFilters): Promise<ReportDetail> {
    const summary = await this.summary(ctx, filters);
    const limit = filters.limit ?? 50;
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      // Histogram buckets — 0-7, 8-14, 15-21, 22-30, 31+ days.
      const hist = await tx.execute<{ bucket: string; n: number }>(sql`
        WITH active AS (
          SELECT extract(epoch from (now() - started_at)) / 86400 AS days_in_yard
            FROM recurring_billing_schedules
           WHERE tenant_id = ${ctx.tenantId}::uuid
             AND deleted_at IS NULL
             AND ended_at IS NULL
        )
        SELECT bucket, count(*)::int AS n FROM (
          SELECT CASE
            WHEN days_in_yard < 7  THEN '0-7'
            WHEN days_in_yard < 14 THEN '8-14'
            WHEN days_in_yard < 21 THEN '15-21'
            WHEN days_in_yard < 30 THEN '22-30'
            ELSE '31+'
          END AS bucket
          FROM active
        ) b
        GROUP BY bucket
        ORDER BY CASE bucket WHEN '0-7' THEN 0 WHEN '8-14' THEN 1 WHEN '15-21' THEN 2 WHEN '22-30' THEN 3 ELSE 4 END
      `);

      // A/R aging on storage invoices — buckets in days past due.
      const aging = await tx.execute<{ bucket: string; n: number; balance_cents: number }>(sql`
        SELECT CASE
                 WHEN now() - due_at <= interval '0 days'  THEN 'current'
                 WHEN now() - due_at <  interval '30 days' THEN '1-30'
                 WHEN now() - due_at <  interval '60 days' THEN '31-60'
                 WHEN now() - due_at <  interval '90 days' THEN '61-90'
                 ELSE '91+'
               END AS bucket,
               count(*)::int AS n,
               coalesce(sum(balance_cents), 0)::bigint AS balance_cents
          FROM invoices
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND deleted_at IS NULL
           AND status <> 'void'
           AND invoice_type = 'recurring_storage'
           AND balance_cents > 0
         GROUP BY 1
         ORDER BY CASE bucket
           WHEN 'current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2 WHEN '61-90' THEN 3 ELSE 4 END
      `);

      // Oldest vehicles list.
      const oldest = await tx.execute<{
        schedule_id: string;
        description: string;
        started_at: string;
        days_in_yard: number;
        daily_rate_cents: number;
        customer_name: string | null;
      }>(sql`
        SELECT s.id AS schedule_id,
               s.description,
               s.started_at,
               (extract(epoch from (now() - s.started_at)) / 86400)::float8 AS days_in_yard,
               s.daily_rate_cents,
               c.name AS customer_name
          FROM recurring_billing_schedules s
          LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.tenant_id = ${ctx.tenantId}::uuid
           AND s.deleted_at IS NULL
           AND s.ended_at IS NULL
         ORDER BY s.started_at ASC
         LIMIT ${limit}
      `);

      const rows = (oldest.rows ?? []).map((r) => ({
        scheduleId: r.schedule_id,
        description: r.description,
        startedAt:
          typeof r.started_at === 'string' ? r.started_at : new Date(r.started_at).toISOString(),
        daysInYard: Number(Number(r.days_in_yard).toFixed(1)),
        dailyRateCents: Number(r.daily_rate_cents),
        customer: r.customer_name ?? '(none)',
        accruedCents: Math.round(Number(r.days_in_yard) * Number(r.daily_rate_cents)),
      }));

      const breakdown = (aging.rows ?? []).map((r) => ({
        key: r.bucket,
        label: agingLabel(r.bucket),
        value: Number(r.balance_cents),
        secondaryValue: Number(r.n),
      }));

      const timeSeries = (hist.rows ?? []).map((r) => ({
        bucket: r.bucket,
        value: Number(r.n),
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
          `Projected lien revenue assumes a ${DAILY_LIEN_DAYS}-day window per jurisdiction default.`,
          'Yard capacity-based utilization arrives once the Yards module ships.',
        ],
      };
    });
  }
}

function agingLabel(b: string): string {
  switch (b) {
    case 'current':
      return 'Current';
    case '1-30':
      return '1-30 days';
    case '31-60':
      return '31-60 days';
    case '61-90':
      return '61-90 days';
    case '91+':
      return '91+ days';
    default:
      return b;
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
