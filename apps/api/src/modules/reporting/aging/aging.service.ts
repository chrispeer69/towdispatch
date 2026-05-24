/**
 * AgingService — A/R aging with per-account drill-down (Session 53).
 *
 * The ar module (Session 29) already computes aging buckets for the billing UI;
 * this adds a reporting-side view bound to the same invoices plus the
 * drill-down the billing report lacked: the open invoices contributing to one
 * account's balance. Read-only over invoices; never mutates billing data.
 */
import { Injectable } from '@nestjs/common';
import type {
  AgingDrilldownResponse,
  AgingInvoiceRow,
  AgingReportResponse,
  AgingReportRow,
} from '@ustowdispatch/shared';
import { sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { ageInDays, bucketOf, normalizeBuckets } from './aging-math.js';

type OpenInvoiceRow = {
  invoice_id: string;
  invoice_number: string | null;
  account_id: string | null;
  account_name: string | null;
  issued_at: string | Date | null;
  due_at: string | Date | null;
  created_at: string | Date;
  total_cents: number | string;
  balance_cents: number | string;
};

@Injectable()
export class AgingService {
  constructor(private readonly db: TenantAwareDb) {}

  async aging(
    ctx: AuthCtx,
    asOf: Date,
    bucketDaysInput: number[] | undefined,
    accountId?: string,
  ): Promise<AgingReportResponse> {
    const buckets = normalizeBuckets(bucketDaysInput);
    const open = await this.loadOpenInvoices(ctx, accountId);

    const byAccount = new Map<string, AgingReportRow>();
    for (const row of open) {
      const due = toDate(row.due_at ?? row.issued_at ?? row.created_at);
      const bucket = bucketOf(ageInDays(due, asOf), buckets);
      const key = row.account_id ?? '__unassigned__';
      const acc =
        byAccount.get(key) ??
        ({
          accountId: row.account_id,
          accountName: row.account_name ?? '(unassigned)',
          balanceTotalCents: 0,
          balanceCurrentCents: 0,
          balance30Cents: 0,
          balance60Cents: 0,
          balance90PlusCents: 0,
          openInvoiceCount: 0,
        } satisfies AgingReportRow);
      const bal = Number(row.balance_cents);
      acc.balanceTotalCents += bal;
      acc.openInvoiceCount += 1;
      if (bucket === 'current') acc.balanceCurrentCents += bal;
      else if (bucket === 'b1') acc.balance30Cents += bal;
      else if (bucket === 'b2') acc.balance60Cents += bal;
      else acc.balance90PlusCents += bal;
      byAccount.set(key, acc);
    }

    const rows = Array.from(byAccount.values()).sort(
      (a, b) => b.balanceTotalCents - a.balanceTotalCents,
    );
    const totals = rows.reduce<AgingReportRow>(
      (acc, r) => ({
        accountId: null,
        accountName: 'Total',
        balanceTotalCents: acc.balanceTotalCents + r.balanceTotalCents,
        balanceCurrentCents: acc.balanceCurrentCents + r.balanceCurrentCents,
        balance30Cents: acc.balance30Cents + r.balance30Cents,
        balance60Cents: acc.balance60Cents + r.balance60Cents,
        balance90PlusCents: acc.balance90PlusCents + r.balance90PlusCents,
        openInvoiceCount: acc.openInvoiceCount + r.openInvoiceCount,
      }),
      {
        accountId: null,
        accountName: 'Total',
        balanceTotalCents: 0,
        balanceCurrentCents: 0,
        balance30Cents: 0,
        balance60Cents: 0,
        balance90PlusCents: 0,
        openInvoiceCount: 0,
      },
    );

    return { asOf: asOf.toISOString(), bucketDays: buckets, rows, totals };
  }

  async drilldown(
    ctx: AuthCtx,
    accountId: string,
    asOf: Date,
    bucketDaysInput?: number[],
  ): Promise<AgingDrilldownResponse> {
    const buckets = normalizeBuckets(bucketDaysInput);
    const open = await this.loadOpenInvoices(ctx, accountId);
    let balanceTotalCents = 0;
    const invoices: AgingInvoiceRow[] = open.map((row) => {
      const due = toDate(row.due_at ?? row.issued_at ?? row.created_at);
      const ageDays = ageInDays(due, asOf);
      balanceTotalCents += Number(row.balance_cents);
      return {
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        issuedAt: row.issued_at ? toDate(row.issued_at).toISOString() : null,
        dueAt: row.due_at ? toDate(row.due_at).toISOString() : null,
        ageDays,
        bucket: bucketOf(ageDays, buckets),
        totalCents: Number(row.total_cents),
        balanceCents: Number(row.balance_cents),
      };
    });
    invoices.sort((a, b) => b.ageDays - a.ageDays);
    return { accountId, asOf: asOf.toISOString(), invoices, balanceTotalCents };
  }

  private async loadOpenInvoices(ctx: AuthCtx, accountId?: string): Promise<OpenInvoiceRow[]> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<OpenInvoiceRow>(sql`
        SELECT i.id AS invoice_id,
               i.invoice_number,
               i.account_id,
               a.name AS account_name,
               i.issued_at,
               i.due_at,
               i.created_at,
               i.total_cents,
               i.balance_cents
          FROM invoices i
          LEFT JOIN accounts a ON a.id = i.account_id
         WHERE i.tenant_id = ${ctx.tenantId}::uuid
           AND i.deleted_at IS NULL
           AND i.status <> 'void'
           AND i.balance_cents > 0
           ${accountId ? sql`AND i.account_id = ${accountId}::uuid` : sql``}
      `);
      return r.rows ?? [];
    });
  }
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
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
