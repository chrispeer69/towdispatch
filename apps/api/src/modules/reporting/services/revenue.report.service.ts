/**
 * Revenue report.
 *
 * Reads from the mv_revenue_daily materialized view for the time-series and
 * dimensional breakdowns (service_type, source, account, motor_club). For
 * the ZIP breakdown we fall through to invoices+customers because the MV
 * does not carry billing_address.zip.
 *
 * The MV is refreshed by ReportingSchedulerService every 5 minutes.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  ReportPage,
  ReportSummary,
  RevenueDimension,
  RevenueRow,
  TimeSeriesPoint,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { bucketKey, resolveWindow } from '../reporting-window.js';

interface RevenueAggregateRow {
  bucket: string;
  source: string;
  service_type: string;
  account_id: string | null;
  total_cents: string | number;
  tax_cents: string | number;
  invoice_count: string | number;
}

@Injectable()
export class RevenueReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const [current, prior] = await Promise.all([
      this.queryAggregates(ctx, win.from, win.to),
      win.priorFrom && win.priorTo ? this.queryAggregates(ctx, win.priorFrom, win.priorTo) : Promise.resolve([]),
    ]);
    const totalCents = current.reduce((s, r) => s + Number(r.total_cents), 0);
    const priorTotal = prior.reduce((s, r) => s + Number(r.total_cents), 0);
    const invoices = current.reduce((s, r) => s + Number(r.invoice_count), 0);
    const taxCents = current.reduce((s, r) => s + Number(r.tax_cents), 0);
    const motorClubCents = current
      .filter((r) => r.source === 'motor_club_submission')
      .reduce((s, r) => s + Number(r.total_cents), 0);
    const changePct = priorTotal > 0 ? (totalCents - priorTotal) / priorTotal : null;
    return {
      reportId: 'revenue',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        {
          label: 'Revenue',
          value: formatMoney(totalCents),
          changePct,
          trend: changePct == null ? 'neutral' : changePct >= 0 ? 'good' : 'bad',
        },
        { label: 'Invoices', value: invoices.toLocaleString() },
        { label: 'Sales tax', value: formatMoney(taxCents) },
        { label: 'Motor club', value: formatMoney(motorClubCents) },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters & { dimension?: RevenueDimension },
  ): Promise<ReportPage<RevenueRow> & { timeSeries: TimeSeriesPoint[] }> {
    const win = resolveWindow(filters);
    const dimension = filters.dimension ?? 'service_type';
    const [current, prior] = await Promise.all([
      this.queryAggregates(ctx, win.from, win.to),
      win.priorFrom && win.priorTo ? this.queryAggregates(ctx, win.priorFrom, win.priorTo) : Promise.resolve([]),
    ]);

    const rows = await this.aggregateByDimension(ctx, dimension, current, prior, win.from, win.to);
    const timeSeries = buildTimeSeries(current, prior, filters.granularity);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    return {
      rows: rows.slice(offset, offset + limit),
      nextCursor: offset + limit < rows.length ? encodeOffset(offset + limit) : null,
      total: rows.length,
      timeSeries,
    };
  }

  private async queryAggregates(
    ctx: ReportContext,
    from: Date,
    to: Date,
  ): Promise<RevenueAggregateRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<RevenueAggregateRow>(sql`
        SELECT
          bucket::text AS bucket,
          source,
          service_type,
          account_id,
          total_cents,
          tax_cents,
          invoice_count
        FROM mv_revenue_daily
        WHERE tenant_id = ${ctx.tenantId}::uuid
          AND bucket >= ${from.toISOString().slice(0, 10)}::date
          AND bucket < ${to.toISOString().slice(0, 10)}::date
        ORDER BY bucket
      `);
      return result.rows;
    });
  }

  private async aggregateByDimension(
    ctx: ReportContext,
    dimension: RevenueDimension,
    current: RevenueAggregateRow[],
    prior: RevenueAggregateRow[],
    from: Date,
    to: Date,
  ): Promise<RevenueRow[]> {
    const accountIds = new Set<string>();
    for (const r of current) if (r.account_id) accountIds.add(r.account_id);
    for (const r of prior) if (r.account_id) accountIds.add(r.account_id);

    let accountById: Map<string, { name: string; isMotorClub: boolean }> = new Map();
    if (accountIds.size > 0) {
      accountById = await this.read.run(ctx, async (db) => {
        const result = await db.execute<{ id: string; name: string; is_motor_club: boolean }>(
          sql`SELECT id::text AS id, name, is_motor_club FROM accounts WHERE id = ANY(${sql.raw(
            `ARRAY[${Array.from(accountIds)
              .map((id) => `'${id}'::uuid`)
              .join(',')}]`,
          )})`,
        );
        const m = new Map<string, { name: string; isMotorClub: boolean }>();
        for (const a of result.rows) m.set(a.id, { name: a.name, isMotorClub: a.is_motor_club });
        return m;
      });
    }

    if (dimension === 'zip') {
      // Fall back to direct invoices+customers join.
      return this.read.run(ctx, async (db) => {
        const result = await db.execute<{ zip: string | null; cents: string | number; jobs: string | number }>(sql`
          SELECT
            COALESCE(NULLIF(c.home_address_zip, ''), '00000') AS zip,
            SUM(i.total_cents)::bigint AS cents,
            COUNT(DISTINCT i.id) AS jobs
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id
          WHERE i.deleted_at IS NULL
            AND i.issued_at >= ${from.toISOString()}
            AND i.issued_at < ${to.toISOString()}
            AND i.status <> 'void'
          GROUP BY zip
          ORDER BY cents DESC
          LIMIT 200
        `);
        return result.rows.map((r) => ({
          dimensionKey: r.zip ?? '00000',
          label: r.zip ?? 'Unknown',
          revenueCents: Number(r.cents),
          jobs: Number(r.jobs),
        }));
      });
    }

    const keyer = (r: RevenueAggregateRow): { key: string; label: string } => {
      switch (dimension) {
        case 'service_type':
          return { key: r.service_type, label: r.service_type };
        case 'source':
          return { key: r.source, label: formatSource(r.source) };
        case 'account': {
          const info = r.account_id ? accountById.get(r.account_id) : null;
          return {
            key: r.account_id ?? 'cash',
            label: info?.name ?? (r.account_id ? r.account_id : 'Cash / direct'),
          };
        }
        case 'motor_club': {
          if (!r.account_id) return { key: '__none__', label: 'Non-motor-club' };
          const info = accountById.get(r.account_id);
          if (!info?.isMotorClub) return { key: '__none__', label: 'Non-motor-club' };
          return { key: r.account_id, label: info.name };
        }
        case 'time':
          return { key: r.bucket, label: r.bucket };
        default:
          return { key: 'all', label: 'All' };
      }
    };

    const agg = new Map<string, { label: string; cents: number; jobs: number; priorCents: number }>();
    for (const r of current) {
      const { key, label } = keyer(r);
      const e = agg.get(key) ?? { label, cents: 0, jobs: 0, priorCents: 0 };
      e.cents += Number(r.total_cents);
      e.jobs += Number(r.invoice_count);
      agg.set(key, e);
    }
    for (const r of prior) {
      const { key, label } = keyer(r);
      const e = agg.get(key) ?? { label, cents: 0, jobs: 0, priorCents: 0 };
      e.priorCents += Number(r.total_cents);
      agg.set(key, e);
    }
    return Array.from(agg.entries())
      .map(([key, e]) => ({
        dimensionKey: key,
        label: e.label,
        revenueCents: e.cents,
        jobs: e.jobs,
        priorRevenueCents: e.priorCents > 0 ? e.priorCents : null,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
  }
}

function buildTimeSeries(
  current: RevenueAggregateRow[],
  prior: RevenueAggregateRow[],
  granularity: 'day' | 'week' | 'month',
): TimeSeriesPoint[] {
  const cur = new Map<string, number>();
  for (const r of current) {
    const k = bucketKey(new Date(`${r.bucket}T00:00:00Z`), granularity);
    cur.set(k, (cur.get(k) ?? 0) + Number(r.total_cents));
  }
  const pri = new Map<string, number>();
  for (const r of prior) {
    const k = bucketKey(new Date(`${r.bucket}T00:00:00Z`), granularity);
    pri.set(k, (pri.get(k) ?? 0) + Number(r.total_cents));
  }
  const keys = Array.from(new Set([...cur.keys(), ...pri.keys()])).sort();
  return keys.map((k) => ({
    bucket: k,
    value: cur.get(k) ?? 0,
    priorValue: pri.has(k) ? pri.get(k)! : null,
  }));
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatSource(s: string): string {
  switch (s) {
    case 'cash_receipt':
      return 'Cash receipt';
    case 'account_invoice':
      return 'Account invoice';
    case 'motor_club_submission':
      return 'Motor club';
    case 'recurring_storage':
      return 'Storage';
    case 'manual':
      return 'Manual';
    default:
      return s;
  }
}
