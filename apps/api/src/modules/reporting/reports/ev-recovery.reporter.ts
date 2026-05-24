/**
 * EV Recovery reporter (Session 48).
 *
 *   - EV jobs by month        (timeSeries: count of ev_job_attributes by the
 *                              month they were created, within the window)
 *   - Thermal events log       (breakdown: count by severity; KPI total)
 *   - Charge stops + reimburse  (rows: each charge stop with cost + who pays;
 *                              KPI of total + reimbursable cost — paid_by
 *                              customer/club is billable back to the operator)
 *
 * All three launch reports fold into this single ReportId — the framework is
 * one reporter per id with KPIs / timeSeries / breakdown / rows. See
 * SESSION_48_DECISIONS.md.
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
export class EvRecoveryReporter implements Reporter {
  readonly id: ReportId = 'ev-recovery';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<{
        ev_jobs: number;
        thermal_events: number;
        critical_events: number;
        charge_stops: number;
        total_charge_cents: number;
        reimbursable_cents: number;
      }>(sql`
        SELECT
          (SELECT count(*)::int FROM ev_job_attributes
             WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
               AND created_at >= ${w.fromDate.toISOString()}::timestamptz
               AND created_at <= ${w.toDate.toISOString()}::timestamptz) AS ev_jobs,
          (SELECT count(*)::int FROM ev_thermal_events
             WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
               AND observed_at >= ${w.fromDate.toISOString()}::timestamptz
               AND observed_at <= ${w.toDate.toISOString()}::timestamptz) AS thermal_events,
          (SELECT count(*)::int FROM ev_thermal_events
             WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
               AND severity IN ('smoke','venting','sparking','flames')
               AND observed_at >= ${w.fromDate.toISOString()}::timestamptz
               AND observed_at <= ${w.toDate.toISOString()}::timestamptz) AS critical_events,
          (SELECT count(*)::int FROM ev_charge_station_visits
             WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
               AND arrived_at >= ${w.fromDate.toISOString()}::timestamptz
               AND arrived_at <= ${w.toDate.toISOString()}::timestamptz) AS charge_stops,
          (SELECT coalesce(sum(cost_cents),0)::bigint FROM ev_charge_station_visits
             WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
               AND arrived_at >= ${w.fromDate.toISOString()}::timestamptz
               AND arrived_at <= ${w.toDate.toISOString()}::timestamptz) AS total_charge_cents,
          (SELECT coalesce(sum(cost_cents),0)::bigint FROM ev_charge_station_visits
             WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
               AND paid_by IN ('customer','club')
               AND arrived_at >= ${w.fromDate.toISOString()}::timestamptz
               AND arrived_at <= ${w.toDate.toISOString()}::timestamptz) AS reimbursable_cents
      `);
      const row = r.rows[0] ?? {
        ev_jobs: 0,
        thermal_events: 0,
        critical_events: 0,
        charge_stops: 0,
        total_charge_cents: 0,
        reimbursable_cents: 0,
      };
      return {
        reportId: this.id,
        headline: 'EV recovery',
        asOf: new Date(),
        kpis: [
          { label: 'EV jobs', value: Number(row.ev_jobs), tone: 'neutral' },
          {
            label: 'Thermal events',
            value: Number(row.thermal_events),
            tone: Number(row.critical_events) > 0 ? 'warn' : 'ok',
          },
          { label: 'Charge stops', value: Number(row.charge_stops), tone: 'neutral' },
          {
            label: 'Reimbursable charge cost',
            value: formatCents(Number(row.reimbursable_cents)),
            tone: 'neutral',
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
      // EV jobs by month.
      const byMonth = await tx.execute<{ bucket: string; n: number }>(sql`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS bucket,
               count(*)::int AS n
          FROM ev_job_attributes
         WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
           AND created_at >= ${w.fromDate.toISOString()}::timestamptz
           AND created_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY 1
         ORDER BY 1
      `);

      // Thermal events by severity.
      const bySeverity = await tx.execute<{ severity: string; n: number }>(sql`
        SELECT severity, count(*)::int AS n
          FROM ev_thermal_events
         WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
           AND observed_at >= ${w.fromDate.toISOString()}::timestamptz
           AND observed_at <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY 1
         ORDER BY n DESC
      `);

      // Charge stops with reimbursement detail.
      const stops = await tx.execute<{
        id: string;
        arrived_at: string;
        station_network: string | null;
        kwh_delivered: string | null;
        cost_cents: number | null;
        paid_by: string;
      }>(sql`
        SELECT id, arrived_at, station_network, kwh_delivered, cost_cents, paid_by
          FROM ev_charge_station_visits
         WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL
           AND arrived_at >= ${w.fromDate.toISOString()}::timestamptz
           AND arrived_at <= ${w.toDate.toISOString()}::timestamptz
         ORDER BY arrived_at DESC
         LIMIT ${limit}
      `);

      const timeSeries = (byMonth.rows ?? []).map((r) => ({
        bucket: r.bucket,
        value: Number(r.n),
      }));

      const breakdown = (bySeverity.rows ?? []).map((r) => ({
        key: r.severity,
        label: severityLabel(r.severity),
        value: Number(r.n),
      }));

      const rows = (stops.rows ?? []).map((r) => ({
        chargeStopId: r.id,
        arrivedAt:
          typeof r.arrived_at === 'string' ? r.arrived_at : new Date(r.arrived_at).toISOString(),
        network: r.station_network ?? '(unknown)',
        kwh: r.kwh_delivered === null ? null : Number(r.kwh_delivered),
        costCents: r.cost_cents === null ? null : Number(r.cost_cents),
        paidBy: r.paid_by,
        reimbursable: r.paid_by === 'customer' || r.paid_by === 'club',
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
          'Reimbursable cost = charge stops paid_by customer or club (billable back to the operator).',
          'Thermal-event severity smoke/venting/sparking/flames are counted as critical.',
        ],
      };
    });
  }
}

function severityLabel(s: string): string {
  const map: Record<string, string> = {
    odor: 'Odor',
    swelling: 'Pack swelling',
    smoke: 'Smoke',
    venting: 'Venting',
    sparking: 'Sparking',
    flames: 'Flames',
  };
  return map[s] ?? s;
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
