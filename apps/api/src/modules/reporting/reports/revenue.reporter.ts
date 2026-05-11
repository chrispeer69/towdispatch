/**
 * Revenue reporter.
 *
 *   - By service type   (jobs.service_type → joined invoice totals)
 *   - By source         (cash, motor_club_submission, account_invoice, manual,
 *                        recurring_storage — derived from invoices.invoice_type)
 *   - By account        (invoices.account_id)
 *   - By motor club     (accounts where is_motor_club, grouped on invoices)
 *   - By ZIP            (customers.home_address_zip on invoices.customer_id)
 *   - By day/week/month (date_trunc on issued_at)
 *   - Prior-period comparison (computed when filters.comparison != 'none')
 *
 * All money is integer cents. We exclude voided invoices everywhere.
 */
import { Injectable } from '@nestjs/common';
import type { ReportId } from '@ustowdispatch/shared';
import { sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../../database/tenant-aware-db.service.js';
import { resolveWindow } from '../reporting-window.js';
import type {
  AuthCtx,
  ReportDetail,
  ReportFilters,
  ReportSummary,
  Reporter,
} from '../reporting.types.js';

@Injectable()
export class RevenueReporter implements Reporter {
  readonly id: ReportId = 'revenue';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const cur = await this.totalsBetween(tx, ctx.tenantId, w.fromDate, w.toDate);
      const prior =
        w.comparisonFromDate && w.comparisonToDate
          ? await this.totalsBetween(tx, ctx.tenantId, w.comparisonFromDate, w.comparisonToDate)
          : null;

      const delta =
        prior && prior.total_cents > 0
          ? ((cur.total_cents - prior.total_cents) / prior.total_cents) * 100
          : null;

      return {
        reportId: this.id,
        headline: 'Revenue',
        asOf: new Date(),
        kpis: [
          {
            label: 'Total billed',
            value: formatCents(cur.total_cents),
            hint: delta === null ? null : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs prior`,
            tone: 'neutral',
          },
          {
            label: 'Collected',
            value: formatCents(cur.paid_cents),
            tone: 'ok',
          },
          {
            label: 'Outstanding',
            value: formatCents(cur.balance_cents),
            tone: cur.balance_cents > 0 ? 'warn' : 'ok',
          },
          {
            label: 'Invoices',
            value: cur.invoice_count,
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
      // Daily series — billed and collected.
      const daily = await tx.execute<{ day: string; billed: number; collected: number }>(sql`
        SELECT to_char(date_trunc('day', coalesce(issued_at, created_at)), 'YYYY-MM-DD') AS day,
               coalesce(sum(total_cents), 0)::bigint AS billed,
               coalesce(sum(paid_cents), 0)::bigint AS collected
          FROM invoices
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND deleted_at IS NULL
           AND status <> 'void'
           AND coalesce(issued_at, created_at) >= ${w.fromDate.toISOString()}::timestamptz
           AND coalesce(issued_at, created_at) <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY day
         ORDER BY day ASC
      `);

      // Breakdown — by source (invoice_type).
      const bySource = await tx.execute<{ invoice_type: string; total_cents: number }>(sql`
        SELECT coalesce(invoice_type, 'manual') AS invoice_type,
               coalesce(sum(total_cents), 0)::bigint AS total_cents
          FROM invoices
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND deleted_at IS NULL
           AND status <> 'void'
           AND coalesce(issued_at, created_at) >= ${w.fromDate.toISOString()}::timestamptz
           AND coalesce(issued_at, created_at) <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY invoice_type
         ORDER BY total_cents DESC
      `);

      // Rows — by account (top N).
      const byAccount = await tx.execute<{
        account_id: string | null;
        account_name: string | null;
        is_motor_club: boolean | null;
        invoices: number;
        billed_cents: number;
        paid_cents: number;
        balance_cents: number;
      }>(sql`
        SELECT i.account_id,
               a.name AS account_name,
               a.is_motor_club,
               count(*)::int AS invoices,
               coalesce(sum(i.total_cents), 0)::bigint AS billed_cents,
               coalesce(sum(i.paid_cents), 0)::bigint AS paid_cents,
               coalesce(sum(i.balance_cents), 0)::bigint AS balance_cents
          FROM invoices i
          LEFT JOIN accounts a ON a.id = i.account_id
         WHERE i.tenant_id = ${ctx.tenantId}::uuid
           AND i.deleted_at IS NULL
           AND i.status <> 'void'
           AND coalesce(i.issued_at, i.created_at) >= ${w.fromDate.toISOString()}::timestamptz
           AND coalesce(i.issued_at, i.created_at) <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY i.account_id, a.name, a.is_motor_club
         ORDER BY billed_cents DESC
         LIMIT ${limit}
      `);

      const rows = (byAccount.rows ?? []).map((r) => ({
        accountId: r.account_id ?? null,
        accountName: r.account_name ?? '(cash / no account)',
        isMotorClub: !!r.is_motor_club,
        invoices: Number(r.invoices),
        billedCents: Number(r.billed_cents),
        paidCents: Number(r.paid_cents),
        balanceCents: Number(r.balance_cents),
      }));

      const breakdown = (bySource.rows ?? []).map((r) => ({
        key: r.invoice_type,
        label: invoiceTypeLabel(r.invoice_type),
        value: Number(r.total_cents),
      }));

      const timeSeries = (daily.rows ?? []).map((r) => ({
        bucket: r.day,
        value: Number(r.billed),
        comparisonValue: Number(r.collected),
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
        notes: ['Voided invoices excluded from every aggregate.'],
      };
    });
  }

  private async totalsBetween(
    tx: Tx,
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    invoice_count: number;
  }> {
    const res = await tx.execute<{
      total_cents: number;
      paid_cents: number;
      balance_cents: number;
      invoice_count: number;
    }>(sql`
      SELECT coalesce(sum(total_cents), 0)::bigint AS total_cents,
             coalesce(sum(paid_cents), 0)::bigint AS paid_cents,
             coalesce(sum(balance_cents), 0)::bigint AS balance_cents,
             count(*)::int AS invoice_count
        FROM invoices
       WHERE tenant_id = ${tenantId}::uuid
         AND deleted_at IS NULL
         AND status <> 'void'
         AND coalesce(issued_at, created_at) >= ${from.toISOString()}::timestamptz
         AND coalesce(issued_at, created_at) <= ${to.toISOString()}::timestamptz
    `);
    const r = res.rows[0] ?? {
      total_cents: 0,
      paid_cents: 0,
      balance_cents: 0,
      invoice_count: 0,
    };
    return {
      total_cents: Number(r.total_cents),
      paid_cents: Number(r.paid_cents),
      balance_cents: Number(r.balance_cents),
      invoice_count: Number(r.invoice_count),
    };
  }
}

function invoiceTypeLabel(t: string): string {
  switch (t) {
    case 'cash_receipt':
      return 'Cash receipt';
    case 'account_invoice':
      return 'Account';
    case 'motor_club_submission':
      return 'Motor club';
    case 'recurring_storage':
      return 'Storage';
    case 'manual':
      return 'Manual';
    default:
      return t;
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
