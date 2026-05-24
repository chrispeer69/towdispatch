/**
 * Tax reporter.
 *
 *   - Sales tax collected by jurisdiction  (invoice_taxes)
 *   - Exemption activity                   (count of invoices on tax-exempt customers
 *                                          with taxable amounts)
 *   - Monthly / quarterly export ready     (each row is one (jurisdiction, period))
 *
 * Voided invoices are excluded. The summary picks the trailing-30 days; the
 * detail respects the filter window.
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
export class TaxReporter implements Reporter {
  readonly id: ReportId = 'tax';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, filters: ReportFilters): Promise<ReportSummary> {
    const w = resolveWindow(filters);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<{
        taxable_cents: number;
        tax_cents: number;
        jurisdictions: number;
        exempt_invoices: number;
      }>(sql`
        SELECT coalesce(sum(it.taxable_amount_cents), 0)::bigint AS taxable_cents,
               coalesce(sum(it.tax_amount_cents), 0)::bigint AS tax_cents,
               count(DISTINCT it.tax_jurisdiction)::int AS jurisdictions,
               (SELECT count(*)::int FROM invoices i2
                  JOIN customers c2 ON c2.id = i2.customer_id
                 WHERE i2.tenant_id = ${ctx.tenantId}::uuid
                   AND i2.deleted_at IS NULL
                   AND i2.status <> 'void'
                   AND c2.tax_exempt = true
                   AND coalesce(i2.issued_at, i2.created_at) >= ${w.fromDate.toISOString()}::timestamptz
                   AND coalesce(i2.issued_at, i2.created_at) <= ${w.toDate.toISOString()}::timestamptz) AS exempt_invoices
          FROM invoice_taxes it
          JOIN invoices i ON i.id = it.invoice_id AND i.status <> 'void' AND i.deleted_at IS NULL
         WHERE it.tenant_id = ${ctx.tenantId}::uuid
           AND coalesce(i.issued_at, i.created_at) >= ${w.fromDate.toISOString()}::timestamptz
           AND coalesce(i.issued_at, i.created_at) <= ${w.toDate.toISOString()}::timestamptz
      `);
      const row = r.rows[0] ?? {
        taxable_cents: 0,
        tax_cents: 0,
        jurisdictions: 0,
        exempt_invoices: 0,
      };
      return {
        reportId: this.id,
        headline: 'Sales tax',
        asOf: new Date(),
        kpis: [
          { label: 'Tax collected', value: formatCents(Number(row.tax_cents)), tone: 'neutral' },
          {
            label: 'Taxable sales',
            value: formatCents(Number(row.taxable_cents)),
            tone: 'neutral',
          },
          { label: 'Jurisdictions', value: Number(row.jurisdictions), tone: 'neutral' },
          {
            label: 'Exempt invoices',
            value: Number(row.exempt_invoices),
            tone: 'neutral',
          },
        ],
      };
    });
  }

  async detail(ctx: AuthCtx, filters: ReportFilters): Promise<ReportDetail> {
    const summary = await this.summary(ctx, filters);
    const w = resolveWindow(filters);
    const limit = filters.limit ?? 100;

    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      // By-jurisdiction rows.
      const rowsRes = await tx.execute<{
        jurisdiction: string;
        tax_name: string;
        invoices: number;
        taxable_cents: number;
        tax_cents: number;
      }>(sql`
        SELECT it.tax_jurisdiction AS jurisdiction,
               max(it.tax_name) AS tax_name,
               count(DISTINCT it.invoice_id)::int AS invoices,
               coalesce(sum(it.taxable_amount_cents), 0)::bigint AS taxable_cents,
               coalesce(sum(it.tax_amount_cents), 0)::bigint AS tax_cents
          FROM invoice_taxes it
          JOIN invoices i ON i.id = it.invoice_id AND i.status <> 'void' AND i.deleted_at IS NULL
         WHERE it.tenant_id = ${ctx.tenantId}::uuid
           AND coalesce(i.issued_at, i.created_at) >= ${w.fromDate.toISOString()}::timestamptz
           AND coalesce(i.issued_at, i.created_at) <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY it.tax_jurisdiction
         ORDER BY tax_cents DESC
         LIMIT ${limit}
      `);

      const rows = (rowsRes.rows ?? []).map((r) => ({
        jurisdiction: r.jurisdiction,
        taxName: r.tax_name ?? r.jurisdiction,
        invoices: Number(r.invoices),
        taxableCents: Number(r.taxable_cents),
        taxCents: Number(r.tax_cents),
      }));

      // Monthly series for the headline chart.
      const monthly = await tx.execute<{ month: string; tax_cents: number }>(sql`
        SELECT to_char(date_trunc('month', coalesce(i.issued_at, i.created_at)), 'YYYY-MM') AS month,
               coalesce(sum(it.tax_amount_cents), 0)::bigint AS tax_cents
          FROM invoice_taxes it
          JOIN invoices i ON i.id = it.invoice_id AND i.status <> 'void' AND i.deleted_at IS NULL
         WHERE it.tenant_id = ${ctx.tenantId}::uuid
           AND coalesce(i.issued_at, i.created_at) >= ${w.fromDate.toISOString()}::timestamptz
           AND coalesce(i.issued_at, i.created_at) <= ${w.toDate.toISOString()}::timestamptz
         GROUP BY month
         ORDER BY month ASC
      `);

      const breakdown = rows.slice(0, 12).map((r) => ({
        key: r.jurisdiction,
        label: r.taxName,
        value: r.taxCents,
      }));

      const timeSeries = (monthly.rows ?? []).map((r) => ({
        bucket: r.month,
        value: Number(r.tax_cents),
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
          'Each row is exportable for monthly or quarterly filing — group by jurisdiction.',
          'Voided invoices excluded; exemption events captured at the customer level.',
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
