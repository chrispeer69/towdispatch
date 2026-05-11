/**
 * Storage & impound report.
 *
 * Source data:
 *   - recurring_billing_schedules (started_at, ended_at, daily_rate_cents)
 *     drives accrued storage fees.
 *   - invoices.invoice_type='recurring_storage' captures invoiced fees.
 *   - jobs.service_type='impound' / vehicle linked to a schedule defines
 *     "vehicles in the yard".
 *
 * Yard utilization % is approximate today — we don't have a capacity number
 * per yard (locations module is a Session 9 stub). We expose total active
 * impound count and leave the percent calc to the UI when the tenant
 * configures capacity. This is documented as a known limitation.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  ReportPage,
  ReportSummary,
  StorageRow,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { resolveWindow } from '../reporting-window.js';

interface StorageStatsRow {
  schedule_id: string;
  vehicle_id: string | null;
  vehicle_label: string | null;
  job_number: string | null;
  started_at: string;
  ended_at: string | null;
  daily_rate_cents: string | number;
  invoiced_cents: string | number;
  paid_cents: string | number;
  yard: string | null;
}

@Injectable()
export class StorageReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const rows = await this.queryStorage(ctx, win.to);
    const active = rows.filter((r) => !r.ended_at);
    const totalAccrued = active.reduce(
      (s, r) => s + daysIn(r.started_at, r.ended_at, win.to) * Number(r.daily_rate_cents),
      0,
    );
    const totalInvoiced = active.reduce((s, r) => s + Number(r.invoiced_cents), 0);
    const totalOutstanding = active.reduce(
      (s, r) => s + (Number(r.invoiced_cents) - Number(r.paid_cents)),
      0,
    );
    const oldest = active.reduce((max, r) => {
      const d = daysIn(r.started_at, r.ended_at, win.to);
      return d > max ? d : max;
    }, 0);
    return {
      reportId: 'storage',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        { label: 'Vehicles in yard', value: active.length.toLocaleString() },
        { label: 'Accrued fees', value: formatMoney(totalAccrued) },
        { label: 'Invoiced fees', value: formatMoney(totalInvoiced) },
        {
          label: 'A/R outstanding',
          value: formatMoney(totalOutstanding),
          trend: totalOutstanding === 0 ? 'good' : 'bad',
        },
        { label: 'Oldest (days)', value: oldest.toLocaleString() },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters,
  ): Promise<ReportPage<StorageRow>> {
    const win = resolveWindow(filters);
    const rows = await this.queryStorage(ctx, win.to);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    const mapped: StorageRow[] = rows.map((r) => {
      const days = daysIn(r.started_at, r.ended_at, win.to);
      const accrued = days * Number(r.daily_rate_cents);
      const invoiced = Number(r.invoiced_cents);
      const paid = Number(r.paid_cents);
      return {
        vehicleId: r.vehicle_id ?? r.schedule_id,
        vehicleLabel: r.vehicle_label ?? 'Vehicle',
        jobNumber: r.job_number ?? '—',
        daysInYard: days,
        accruedFeesCents: accrued,
        invoicedFeesCents: invoiced,
        outstandingCents: invoiced - paid,
        yard: r.yard,
      };
    });
    mapped.sort((a, b) => b.daysInYard - a.daysInYard);
    return {
      rows: mapped.slice(offset, offset + limit),
      nextCursor: offset + limit < mapped.length ? encodeOffset(offset + limit) : null,
      total: mapped.length,
    };
  }

  private async queryStorage(ctx: ReportContext, asOf: Date): Promise<StorageStatsRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<StorageStatsRow>(sql`
        SELECT
          s.id AS schedule_id,
          v.id AS vehicle_id,
          COALESCE(
            NULLIF(TRIM(CONCAT(v.year, ' ', v.make, ' ', v.model)), '')
            , v.vin, v.plate, 'Vehicle') AS vehicle_label,
          j.job_number,
          s.started_at::text AS started_at,
          s.ended_at::text AS ended_at,
          s.daily_rate_cents,
          COALESCE((
            SELECT SUM(i.total_cents)::bigint FROM invoices i
            WHERE i.deleted_at IS NULL
              AND i.invoice_type = 'recurring_storage'
              AND i.job_id = s.job_id
              AND i.status <> 'void'
          ), 0) AS invoiced_cents,
          COALESCE((
            SELECT SUM(i.paid_cents)::bigint FROM invoices i
            WHERE i.deleted_at IS NULL
              AND i.invoice_type = 'recurring_storage'
              AND i.job_id = s.job_id
              AND i.status <> 'void'
          ), 0) AS paid_cents,
          NULL::text AS yard
        FROM recurring_billing_schedules s
        LEFT JOIN jobs j ON j.id = s.job_id
        LEFT JOIN vehicles v ON v.id = j.vehicle_id
        WHERE s.deleted_at IS NULL
          AND s.started_at <= ${asOf.toISOString()}
        ORDER BY s.started_at ASC
        LIMIT 500
      `);
      return result.rows;
    });
  }
}

function daysIn(startedAt: string, endedAt: string | null, asOf: Date): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : asOf.getTime();
  const diffMs = Math.max(0, end - start);
  return Math.floor(diffMs / 86_400_000);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
