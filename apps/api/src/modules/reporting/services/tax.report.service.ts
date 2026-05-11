/**
 * Tax report.
 *
 * Pulls from invoice_taxes (per-jurisdiction lines) and joins to invoices to
 * filter by issue date. Exempt sales are inferred by joining invoices that
 * have line items with taxable=false; that's a coarse proxy but consistent
 * with how the billing module treats exemption.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  ReportPage,
  ReportSummary,
  TaxRow,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';
import { resolveWindow } from '../reporting-window.js';

interface TaxAggregateRow {
  jurisdiction: string;
  tax_name: string;
  taxable_cents: string | number;
  tax_cents: string | number;
  exempt_cents: string | number;
  invoice_count: string | number;
}

@Injectable()
export class TaxReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportSummary> {
    const win = resolveWindow(filters);
    const rows = await this.queryAggregate(ctx, win.from, win.to);
    const totals = rows.reduce(
      (a, r) => ({
        taxable: a.taxable + Number(r.taxable_cents),
        collected: a.collected + Number(r.tax_cents),
        exempt: a.exempt + Number(r.exempt_cents),
        invoices: a.invoices + Number(r.invoice_count),
      }),
      { taxable: 0, collected: 0, exempt: 0, invoices: 0 },
    );
    return {
      reportId: 'tax',
      generatedAt: new Date().toISOString(),
      windowFrom: win.from.toISOString(),
      windowTo: win.to.toISOString(),
      kpis: [
        { label: 'Tax collected', value: formatMoney(totals.collected) },
        { label: 'Taxable sales', value: formatMoney(totals.taxable) },
        { label: 'Exempt sales', value: formatMoney(totals.exempt) },
        { label: 'Invoices', value: totals.invoices.toLocaleString() },
      ],
    };
  }

  async list(ctx: ReportContext, filters: CommonReportFilters): Promise<ReportPage<TaxRow>> {
    const win = resolveWindow(filters);
    const rows = await this.queryAggregate(ctx, win.from, win.to);
    const mapped: TaxRow[] = rows.map((r) => ({
      jurisdiction: r.jurisdiction,
      taxName: r.tax_name,
      taxableSalesCents: Number(r.taxable_cents),
      taxCollectedCents: Number(r.tax_cents),
      exemptSalesCents: Number(r.exempt_cents),
      invoiceCount: Number(r.invoice_count),
    }));
    mapped.sort((a, b) => b.taxCollectedCents - a.taxCollectedCents);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    return {
      rows: mapped.slice(offset, offset + limit),
      nextCursor: offset + limit < mapped.length ? encodeOffset(offset + limit) : null,
      total: mapped.length,
    };
  }

  private async queryAggregate(
    ctx: ReportContext,
    from: Date,
    to: Date,
  ): Promise<TaxAggregateRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<TaxAggregateRow>(sql`
        WITH issued AS (
          SELECT i.id, i.tenant_id
          FROM invoices i
          WHERE i.deleted_at IS NULL
            AND i.issued_at >= ${from.toISOString()}
            AND i.issued_at < ${to.toISOString()}
            AND i.status <> 'void'
        ),
        exempt AS (
          SELECT
            i.id,
            SUM(CASE WHEN li.taxable = false THEN li.line_total_cents ELSE 0 END)::bigint AS exempt_cents
          FROM issued i
          LEFT JOIN invoice_line_items li ON li.invoice_id = i.id
          GROUP BY i.id
        )
        SELECT
          COALESCE(t.tax_jurisdiction, 'Unspecified') AS jurisdiction,
          COALESCE(t.tax_name, 'Sales tax') AS tax_name,
          COALESCE(SUM(t.taxable_amount_cents), 0)::bigint AS taxable_cents,
          COALESCE(SUM(t.tax_amount_cents), 0)::bigint AS tax_cents,
          COALESCE(SUM(e.exempt_cents), 0)::bigint AS exempt_cents,
          COUNT(DISTINCT t.invoice_id) AS invoice_count
        FROM invoice_taxes t
        JOIN issued i ON i.id = t.invoice_id
        LEFT JOIN exempt e ON e.id = t.invoice_id
        GROUP BY t.tax_jurisdiction, t.tax_name
      `);
      return result.rows;
    });
  }
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
