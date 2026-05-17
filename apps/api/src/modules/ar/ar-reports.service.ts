/**
 * ArReportsService — five canned report templates that the operator runs
 * from /billing/aging/reports. Each template has a dedicated query path
 * because the grouping + aggregation differs per report.
 *
 *   aging_summary          → invoice aging buckets, grouped by chosen dim
 *   past_due_by_account    → only past-due rows, grouped by account
 *   revenue_summary        → billed/paid/outstanding/void totals
 *   payment_activity       → individual payments in a date range
 *   driver_commissions     → per-driver commission earnings (ADMIN ONLY)
 *
 * Each report is rendered three ways: JSON (for the in-page table),
 * Excel (exceljs), and PDF (pdfkit). Excel/PDF rendering is shared via
 * ArExportService — this service produces the JSON ArReportResponse.
 */
import { Injectable } from '@nestjs/common';
import { accounts, drivers, invoices, jobs, payments, tenants } from '@ustowdispatch/db';
import {
  type ArReportFilters,
  type ArReportId,
  type ArReportResponse,
  type ArReportRow,
  resolveDelinquencyDays,
} from '@ustowdispatch/shared';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { readInvoiceDefaults } from './tenant-settings.helper.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class ArReportsService {
  constructor(private readonly db: TenantAwareDb) {}

  async run(
    ctx: CallerContext,
    reportId: ArReportId,
    filters: ArReportFilters,
  ): Promise<ArReportResponse> {
    switch (reportId) {
      case 'aging_summary':
        return this.runAgingSummary(ctx, filters);
      case 'past_due_by_account':
        return this.runPastDueByAccount(ctx, filters);
      case 'revenue_summary':
        return this.runRevenueSummary(ctx, filters);
      case 'payment_activity':
        return this.runPaymentActivity(ctx, filters);
      case 'driver_commissions':
        return this.runDriverCommissions(ctx, filters);
    }
  }

  // ---------- 1) Aging Summary ----------

  private async runAgingSummary(
    ctx: CallerContext,
    filters: ArReportFilters,
  ): Promise<ArReportResponse> {
    const groupBy = filters.groupBy ?? 'account';
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [
        isNull(invoices.deletedAt),
        sql`${invoices.balanceCents} > 0`,
        inArray(invoices.status, ['issued', 'sent', 'partially_paid', 'overdue']),
      ];
      if (filters.dateFrom) conds.push(gte(invoices.issuedAt, new Date(filters.dateFrom)));
      if (filters.dateTo) conds.push(lte(invoices.issuedAt, new Date(filters.dateTo)));
      const rows = await tx.query.invoices.findMany({ where: and(...conds) });
      const acctIds = uniqueIds(rows.map((r) => r.accountId));
      const acctRows = acctIds.length
        ? await tx.query.accounts.findMany({ where: inArray(accounts.id, acctIds) })
        : [];
      const acctMap = new Map(acctRows.map((a) => [a.id, a]));

      const now = new Date();
      const buckets = new Map<
        string,
        {
          groupLabel: string;
          groupId: string | null;
          current: number;
          b1to30: number;
          b31to60: number;
          b61to90: number;
          b91plus: number;
          total: number;
          count: number;
        }
      >();

      for (const r of rows) {
        const acct = r.accountId ? (acctMap.get(r.accountId) ?? null) : null;
        const key =
          groupBy === 'tenant'
            ? '__tenant__'
            : groupBy === 'customer'
              ? `c:${r.customerId ?? 'unknown'}`
              : `a:${acct?.id ?? 'cash'}`;
        const label =
          groupBy === 'tenant'
            ? 'Tenant Total'
            : groupBy === 'customer'
              ? (r.customerId ?? 'Unknown customer')
              : (acct?.name ?? 'Cash customers');
        const groupId = groupBy === 'tenant' ? null : (acct?.id ?? r.customerId ?? null);
        const bucket = buckets.get(key) ?? {
          groupLabel: label,
          groupId,
          current: 0,
          b1to30: 0,
          b31to60: 0,
          b61to90: 0,
          b91plus: 0,
          total: 0,
          count: 0,
        };
        const due = r.dueAt ?? r.issuedAt ?? r.createdAt;
        const ageDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        if (ageDays <= 0) bucket.current += r.balanceCents;
        else if (ageDays <= 30) bucket.b1to30 += r.balanceCents;
        else if (ageDays <= 60) bucket.b31to60 += r.balanceCents;
        else if (ageDays <= 90) bucket.b61to90 += r.balanceCents;
        else bucket.b91plus += r.balanceCents;
        bucket.total += r.balanceCents;
        bucket.count += 1;
        buckets.set(key, bucket);
      }

      const reportRows: ArReportRow[] = Array.from(buckets.values())
        .sort((a, b) => b.total - a.total)
        .map((b) => ({
          groupLabel: b.groupLabel,
          groupId: b.groupId,
          values: {
            invoiceCount: b.count,
            current: b.current,
            bucket1To30: b.b1to30,
            bucket31To60: b.b31to60,
            bucket61To90: b.b61to90,
            bucket91Plus: b.b91plus,
            total: b.total,
          },
        }));

      const totals = reportRows.reduce(
        (acc, r) => {
          for (const key of [
            'invoiceCount',
            'current',
            'bucket1To30',
            'bucket31To60',
            'bucket61To90',
            'bucket91Plus',
            'total',
          ]) {
            acc[key] = (Number(acc[key] ?? 0) + Number(r.values[key] ?? 0)) as number;
          }
          return acc;
        },
        {} as Record<string, number | string | null>,
      );

      return {
        reportId: 'aging_summary',
        generatedAt: new Date().toISOString(),
        filters: { groupBy, dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
        columns: [
          { key: 'groupLabel', label: groupByLabel(groupBy) },
          { key: 'invoiceCount', label: '#', align: 'right' },
          { key: 'current', label: 'Current', align: 'right' },
          { key: 'bucket1To30', label: '1-30', align: 'right' },
          { key: 'bucket31To60', label: '31-60', align: 'right' },
          { key: 'bucket61To90', label: '61-90', align: 'right' },
          { key: 'bucket91Plus', label: '91+', align: 'right' },
          { key: 'total', label: 'Total', align: 'right' },
        ],
        rows: reportRows,
        totals,
      };
    });
  }

  // ---------- 2) Past Due by Account ----------

  private async runPastDueByAccount(
    ctx: CallerContext,
    filters: ArReportFilters,
  ): Promise<ArReportResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tenantRow = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      const tenantDefaults = readInvoiceDefaults(
        (tenantRow?.settings as Record<string, unknown> | null) ?? {},
      );

      const conds = [
        isNull(invoices.deletedAt),
        sql`${invoices.balanceCents} > 0`,
        inArray(invoices.status, ['issued', 'sent', 'partially_paid', 'overdue']),
      ];
      if (filters.dateFrom) conds.push(gte(invoices.issuedAt, new Date(filters.dateFrom)));
      if (filters.dateTo) conds.push(lte(invoices.issuedAt, new Date(filters.dateTo)));
      const rows = await tx.query.invoices.findMany({ where: and(...conds) });
      const acctIds = uniqueIds(rows.map((r) => r.accountId));
      const acctRows = acctIds.length
        ? await tx.query.accounts.findMany({ where: inArray(accounts.id, acctIds) })
        : [];
      const acctMap = new Map(acctRows.map((a) => [a.id, a]));

      const now = new Date();
      type Aggr = {
        accountId: string | null;
        accountName: string;
        count: number;
        totalCents: number;
        oldestPostedAt: Date | null;
        sumOverdueDays: number;
      };
      const agg = new Map<string, Aggr>();
      for (const r of rows) {
        const acct = r.accountId ? (acctMap.get(r.accountId) ?? null) : null;
        const threshold = resolveDelinquencyDays(
          acct?.delinquencyDaysThreshold ?? null,
          Boolean(acct),
          tenantDefaults,
        );
        const posted = r.issuedAt ?? r.createdAt;
        const ageDays = Math.floor((now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24));
        const daysOverdue = ageDays - threshold;
        if (daysOverdue < 0) continue;
        const key = acct?.id ?? 'cash';
        const entry = agg.get(key) ?? {
          accountId: acct?.id ?? null,
          accountName: acct?.name ?? 'Cash customers',
          count: 0,
          totalCents: 0,
          oldestPostedAt: null,
          sumOverdueDays: 0,
        };
        entry.count += 1;
        entry.totalCents += r.balanceCents;
        entry.sumOverdueDays += daysOverdue;
        if (!entry.oldestPostedAt || posted < entry.oldestPostedAt) entry.oldestPostedAt = posted;
        agg.set(key, entry);
      }

      const reportRows: ArReportRow[] = Array.from(agg.values())
        .sort((a, b) => b.totalCents - a.totalCents)
        .map((e) => ({
          groupLabel: e.accountName,
          groupId: e.accountId,
          values: {
            invoiceCount: e.count,
            totalBalance: e.totalCents,
            avgDaysOverdue: e.count > 0 ? Math.round(e.sumOverdueDays / e.count) : 0,
            oldestInvoiceDate: e.oldestPostedAt
              ? e.oldestPostedAt.toISOString().slice(0, 10)
              : null,
          },
        }));

      const totals = reportRows.reduce(
        (acc, r) => ({
          invoiceCount: Number(acc.invoiceCount ?? 0) + Number(r.values.invoiceCount ?? 0),
          totalBalance: Number(acc.totalBalance ?? 0) + Number(r.values.totalBalance ?? 0),
        }),
        {} as Record<string, number | string | null>,
      );

      return {
        reportId: 'past_due_by_account',
        generatedAt: new Date().toISOString(),
        filters: { dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
        columns: [
          { key: 'groupLabel', label: 'Account' },
          { key: 'invoiceCount', label: '# Past Due', align: 'right' },
          { key: 'totalBalance', label: 'Total Balance', align: 'right' },
          { key: 'avgDaysOverdue', label: 'Avg Days Overdue', align: 'right' },
          { key: 'oldestInvoiceDate', label: 'Oldest Invoice Date' },
        ],
        rows: reportRows,
        totals,
      };
    });
  }

  // ---------- 3) Revenue Summary ----------

  private async runRevenueSummary(
    ctx: CallerContext,
    filters: ArReportFilters,
  ): Promise<ArReportResponse> {
    const groupBy = filters.groupBy ?? 'tenant';
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(invoices.deletedAt)];
      if (filters.dateFrom) conds.push(gte(invoices.issuedAt, new Date(filters.dateFrom)));
      if (filters.dateTo) conds.push(lte(invoices.issuedAt, new Date(filters.dateTo)));
      const rows = await tx.query.invoices.findMany({ where: and(...conds) });
      const acctIds = uniqueIds(rows.map((r) => r.accountId));
      const acctRows = acctIds.length
        ? await tx.query.accounts.findMany({ where: inArray(accounts.id, acctIds) })
        : [];
      const acctMap = new Map(acctRows.map((a) => [a.id, a]));

      type Aggr = {
        groupLabel: string;
        groupId: string | null;
        billed: number;
        paid: number;
        outstanding: number;
        voided: number;
        refunded: number;
      };
      const agg = new Map<string, Aggr>();
      for (const r of rows) {
        const acct = r.accountId ? (acctMap.get(r.accountId) ?? null) : null;
        const key =
          groupBy === 'tenant'
            ? '__tenant__'
            : groupBy === 'account'
              ? `a:${acct?.id ?? 'cash'}`
              : `c:${r.customerId ?? 'unknown'}`;
        const label =
          groupBy === 'tenant'
            ? 'Tenant Total'
            : groupBy === 'account'
              ? (acct?.name ?? 'Cash customers')
              : 'Customer';
        const e = agg.get(key) ?? {
          groupLabel: label,
          groupId: groupBy === 'tenant' ? null : (acct?.id ?? r.customerId ?? null),
          billed: 0,
          paid: 0,
          outstanding: 0,
          voided: 0,
          refunded: 0,
        };
        if (r.status === 'void') e.voided += r.totalCents;
        else if (r.status === 'refunded') e.refunded += r.totalCents;
        else {
          e.billed += r.totalCents;
          e.paid += r.paidCents;
          e.outstanding += r.balanceCents;
        }
        agg.set(key, e);
      }

      const reportRows: ArReportRow[] = Array.from(agg.values())
        .sort((a, b) => b.billed - a.billed)
        .map((e) => ({
          groupLabel: e.groupLabel,
          groupId: e.groupId,
          values: {
            billed: e.billed,
            paid: e.paid,
            outstanding: e.outstanding,
            voided: e.voided,
            refunded: e.refunded,
          },
        }));

      const totals = reportRows.reduce(
        (acc, r) => {
          for (const k of ['billed', 'paid', 'outstanding', 'voided', 'refunded']) {
            acc[k] = (Number(acc[k] ?? 0) + Number(r.values[k] ?? 0)) as number;
          }
          return acc;
        },
        {} as Record<string, number | string | null>,
      );

      return {
        reportId: 'revenue_summary',
        generatedAt: new Date().toISOString(),
        filters: { groupBy, dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
        columns: [
          { key: 'groupLabel', label: groupByLabel(groupBy) },
          { key: 'billed', label: 'Billed', align: 'right' },
          { key: 'paid', label: 'Paid', align: 'right' },
          { key: 'outstanding', label: 'Outstanding', align: 'right' },
          { key: 'voided', label: 'Voided', align: 'right' },
          { key: 'refunded', label: 'Refunded', align: 'right' },
        ],
        rows: reportRows,
        totals,
      };
    });
  }

  // ---------- 4) Payment Activity ----------

  private async runPaymentActivity(
    ctx: CallerContext,
    filters: ArReportFilters,
  ): Promise<ArReportResponse> {
    const groupBy = filters.groupBy ?? 'account';
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(payments.deletedAt), eq(payments.status, 'cleared' as const)];
      if (filters.dateFrom) conds.push(gte(payments.receivedAt, new Date(filters.dateFrom)));
      if (filters.dateTo) conds.push(lte(payments.receivedAt, new Date(filters.dateTo)));
      const rows = await tx.query.payments.findMany({ where: and(...conds) });

      type Aggr = {
        groupLabel: string;
        groupId: string | null;
        count: number;
        amount: number;
        fees: number;
        netAmount: number;
      };
      const agg = new Map<string, Aggr>();

      // Pre-fetch invoice→account map for grouping by account.
      const invoiceIds = uniqueIds(rows.map((r) => r.invoiceId));
      const invoiceRows = invoiceIds.length
        ? await tx.query.invoices.findMany({ where: inArray(invoices.id, invoiceIds) })
        : [];
      const invoiceMap = new Map(invoiceRows.map((i) => [i.id, i]));
      const acctIds = uniqueIds(invoiceRows.map((i) => i.accountId));
      const acctRows = acctIds.length
        ? await tx.query.accounts.findMany({ where: inArray(accounts.id, acctIds) })
        : [];
      const acctMap = new Map(acctRows.map((a) => [a.id, a]));

      for (const p of rows) {
        const inv = invoiceMap.get(p.invoiceId);
        const acct = inv?.accountId ? (acctMap.get(inv.accountId) ?? null) : null;
        const key =
          groupBy === 'tenant'
            ? '__tenant__'
            : groupBy === 'account'
              ? `a:${acct?.id ?? 'cash'}`
              : `m:${p.paymentMethod}`;
        const label =
          groupBy === 'tenant'
            ? 'Tenant Total'
            : groupBy === 'account'
              ? (acct?.name ?? 'Cash customers')
              : labelForMethod(p.paymentMethod);
        const e = agg.get(key) ?? {
          groupLabel: label,
          groupId: groupBy === 'account' ? (acct?.id ?? null) : null,
          count: 0,
          amount: 0,
          fees: 0,
          netAmount: 0,
        };
        e.count += 1;
        e.amount += p.amountCents;
        e.fees += p.stripeFeeCents;
        e.netAmount += p.amountCents - p.stripeFeeCents;
        agg.set(key, e);
      }

      const reportRows: ArReportRow[] = Array.from(agg.values())
        .sort((a, b) => b.amount - a.amount)
        .map((e) => ({
          groupLabel: e.groupLabel,
          groupId: e.groupId,
          values: {
            count: e.count,
            amount: e.amount,
            fees: e.fees,
            netAmount: e.netAmount,
          },
        }));

      const totals = reportRows.reduce(
        (acc, r) => {
          for (const k of ['count', 'amount', 'fees', 'netAmount']) {
            acc[k] = (Number(acc[k] ?? 0) + Number(r.values[k] ?? 0)) as number;
          }
          return acc;
        },
        {} as Record<string, number | string | null>,
      );

      return {
        reportId: 'payment_activity',
        generatedAt: new Date().toISOString(),
        filters: { groupBy, dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
        columns: [
          { key: 'groupLabel', label: groupByLabel(groupBy) },
          { key: 'count', label: '# Payments', align: 'right' },
          { key: 'amount', label: 'Gross', align: 'right' },
          { key: 'fees', label: 'Fees', align: 'right' },
          { key: 'netAmount', label: 'Net', align: 'right' },
        ],
        rows: reportRows,
        totals,
      };
    });
  }

  // ---------- 5) Driver Commissions (admin-only — caller-gated) ----------

  private async runDriverCommissions(
    ctx: CallerContext,
    filters: ArReportFilters,
  ): Promise<ArReportResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // We compute commissions from the invoices + the driver's default
      // commission pct, since the line-level invoice_line_commissions
      // table from prior builds isn't part of the current schema. The
      // driver's default_commission_pct is multiplied by each completed
      // job's invoice total to produce an approximation.
      const conds = [isNull(invoices.deletedAt)];
      if (filters.dateFrom) conds.push(gte(invoices.issuedAt, new Date(filters.dateFrom)));
      if (filters.dateTo) conds.push(lte(invoices.issuedAt, new Date(filters.dateTo)));
      const invs = await tx.query.invoices.findMany({ where: and(...conds) });
      const jobIds = uniqueIds(invs.map((i) => i.jobId));
      const jobRows = jobIds.length
        ? await tx.query.jobs.findMany({ where: inArray(jobs.id, jobIds) })
        : [];
      const jobMap = new Map(jobRows.map((j) => [j.id, j]));
      const driverIds = uniqueIds(jobRows.map((j) => j.assignedDriverId));
      const driverRows = driverIds.length
        ? await tx.query.drivers.findMany({ where: inArray(drivers.id, driverIds) })
        : [];
      const driverMap = new Map(driverRows.map((d) => [d.id, d]));

      type Aggr = {
        driverId: string;
        driverName: string;
        invoiceCount: number;
        totalCents: number;
        commissionCents: number;
      };
      const agg = new Map<string, Aggr>();
      for (const inv of invs) {
        const job = inv.jobId ? jobMap.get(inv.jobId) : null;
        const driver = job?.assignedDriverId ? driverMap.get(job.assignedDriverId) : null;
        if (!driver) continue;
        const pct =
          Number((driver as { defaultCommissionPct?: string | null }).defaultCommissionPct ?? 0) ||
          0;
        const commission = Math.round((inv.totalCents * pct) / 100);
        const e = agg.get(driver.id) ?? {
          driverId: driver.id,
          driverName: `${driver.firstName} ${driver.lastName}`.trim(),
          invoiceCount: 0,
          totalCents: 0,
          commissionCents: 0,
        };
        e.invoiceCount += 1;
        e.totalCents += inv.totalCents;
        e.commissionCents += commission;
        agg.set(driver.id, e);
      }

      const reportRows: ArReportRow[] = Array.from(agg.values())
        .sort((a, b) => b.commissionCents - a.commissionCents)
        .map((e) => ({
          groupLabel: e.driverName,
          groupId: e.driverId,
          values: {
            invoiceCount: e.invoiceCount,
            totalRevenue: e.totalCents,
            commission: e.commissionCents,
            avgCommission: e.invoiceCount > 0 ? Math.round(e.commissionCents / e.invoiceCount) : 0,
          },
        }));

      const totals = reportRows.reduce(
        (acc, r) => {
          for (const k of ['invoiceCount', 'totalRevenue', 'commission']) {
            acc[k] = (Number(acc[k] ?? 0) + Number(r.values[k] ?? 0)) as number;
          }
          return acc;
        },
        {} as Record<string, number | string | null>,
      );

      return {
        reportId: 'driver_commissions',
        generatedAt: new Date().toISOString(),
        filters: { dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
        columns: [
          { key: 'groupLabel', label: 'Driver' },
          { key: 'invoiceCount', label: '# Invoices', align: 'right' },
          { key: 'totalRevenue', label: 'Revenue', align: 'right' },
          { key: 'commission', label: 'Commission', align: 'right' },
          { key: 'avgCommission', label: 'Avg / Invoice', align: 'right' },
        ],
        rows: reportRows,
        totals,
      };
    });
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

function groupByLabel(g: string): string {
  return g === 'tenant'
    ? 'Tenant'
    : g === 'account'
      ? 'Account'
      : g === 'customer'
        ? 'Customer'
        : g === 'driver'
          ? 'Driver'
          : 'Group';
}

function labelForMethod(m: string): string {
  switch (m) {
    case 'cash':
      return 'Cash';
    case 'check':
      return 'Check';
    case 'credit_card':
      return 'Credit Card';
    case 'ach':
      return 'ACH';
    case 'account_credit':
      return 'Account Credit';
    case 'motor_club_remittance':
      return 'Motor Club';
    case 'write_off':
      return 'Write-off';
    default:
      return m;
  }
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  const s = new Set<string>();
  for (const v of values) if (v) s.add(v);
  return Array.from(s);
}
