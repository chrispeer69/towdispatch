/**
 * ArSearchService — the data layer for /billing/aging (the new A/R
 * search workspace) and the past-due detector for the Monday RED ALERT.
 *
 * Past-due semantics — this is MOAT #7's core logic:
 *
 *   past_due = (status in 'issued'|'sent'|'partially_paid'|'overdue')
 *           AND (balance_cents > 0)
 *           AND (now - posted_date) >= delinquency_days_threshold
 *
 * "Posted date" is invoice.issuedAt when present, otherwise invoice.createdAt
 * (we treat the moment the invoice left draft as the posted date).
 *
 * Threshold lookup:
 *   1. If account.delinquency_days_threshold IS NOT NULL → use it.
 *   2. Else if invoice has an account → tenant.defaultDelinquencyDays.
 *   3. Else (cash customer)            → tenant.cashCustomerDelinquencyDays.
 *
 * Tenant defaults default to 30/7 when unset (see DEFAULT_TENANT_INVOICE_DEFAULTS).
 */
import { Injectable } from '@nestjs/common';
import { accounts, customers, drivers, invoices, jobs, tenants } from '@ustowdispatch/db';
import {
  type ArSearchFilters,
  type ArSearchResponse,
  type ArSearchRow,
  type InvoiceStatus,
  resolveDelinquencyDays,
} from '@ustowdispatch/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
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
export class ArSearchService {
  constructor(private readonly db: TenantAwareDb) {}

  async search(ctx: CallerContext, filters: ArSearchFilters): Promise<ArSearchResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tenantRow = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      const tenantDefaults = readInvoiceDefaults(
        (tenantRow?.settings as Record<string, unknown> | null) ?? {},
      );

      const conds = [isNull(invoices.deletedAt)];

      // Date range — pick the column based on dateField. We always join
      // on the same invoices row, so the column choice is just which
      // timestamp gets the gte/lte bound applied.
      const dateColumn =
        filters.dateField === 'due_at'
          ? invoices.dueAt
          : filters.dateField === 'created_at'
            ? invoices.createdAt
            : filters.dateField === 'paid_at'
              ? invoices.paidAt
              : invoices.issuedAt;
      if (filters.dateFrom) conds.push(gte(dateColumn, new Date(filters.dateFrom)));
      if (filters.dateTo) conds.push(lte(dateColumn, new Date(filters.dateTo)));

      if (filters.accountIds && filters.accountIds.length > 0) {
        conds.push(inArray(invoices.accountId, filters.accountIds));
      }
      if (filters.minAmountCents !== undefined) {
        conds.push(sql`${invoices.totalCents} >= ${filters.minAmountCents}`);
      }
      if (filters.maxAmountCents !== undefined) {
        conds.push(sql`${invoices.totalCents} <= ${filters.maxAmountCents}`);
      }
      if (filters.q && filters.q.trim().length > 0) {
        const pat = `%${filters.q.toLowerCase()}%`;
        // Inline subqueries against customers + accounts so the search
        // string matches across invoice number, customer name, and
        // account name in a single SQL pass.
        conds.push(
          or(
            sql`lower(${invoices.invoiceNumber}) LIKE ${pat}`,
            sql`${invoices.customerId} IN (SELECT id FROM customers WHERE lower(name) LIKE ${pat})`,
            sql`${invoices.accountId} IN (SELECT id FROM accounts WHERE lower(name) LIKE ${pat})`,
          ) as ReturnType<typeof eq>,
        );
      }

      // Status filter: 'past_due' is computed — see top-of-file comment.
      // We expand the multi-select into a real-statuses-OR-past-due OR.
      // If past_due is selected, we union in (status IN issued/sent/...
      // AND balance > 0 AND posted_date older than threshold), but the
      // threshold varies by account, so we can't do that in pure SQL
      // without a complex CASE. We push that down into the application
      // layer: the SQL filter is permissive (the candidate set), then
      // we drop rows that don't pass past_due semantics post-query.
      const statusFilter = filters.statuses ?? null;
      const realStatuses: InvoiceStatus[] = [];
      let wantsPastDue = false;
      if (statusFilter) {
        for (const s of statusFilter) {
          if (s === 'past_due') wantsPastDue = true;
          else realStatuses.push(s as InvoiceStatus);
        }
        // When the operator picks 'past_due' alone, we still need a
        // candidate set of open statuses to test threshold against.
        // The state-machine intersection of "could be past_due" =
        // anything in [issued, sent, partially_paid, overdue].
        if (wantsPastDue && realStatuses.length === 0) {
          realStatuses.push('issued', 'sent', 'partially_paid', 'overdue');
        }
        // If only real statuses, OR them. If past_due AND real, the
        // real statuses cover everything past_due could match (above
        // intersection), so a plain IN check works.
        conds.push(inArray(invoices.status, realStatuses));
      }

      // Pre-count: get total row count for pagination footer.
      const totalCountRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(and(...conds));
      const total = totalCountRow[0]?.count ?? 0;

      // Sort
      const orderColumn =
        filters.sortBy === 'due_at'
          ? invoices.dueAt
          : filters.sortBy === 'invoice_number'
            ? invoices.invoiceNumber
            : filters.sortBy === 'total_cents'
              ? invoices.totalCents
              : filters.sortBy === 'balance_cents'
                ? invoices.balanceCents
                : invoices.issuedAt;
      const order = filters.sortDir === 'asc' ? asc(orderColumn) : desc(orderColumn);

      // We over-fetch by a factor of 2 when wantsPastDue, then app-
      // filter; this keeps the pagination usable even when the SQL
      // status filter is a superset. Cap so memory doesn't explode.
      const overshoot = wantsPastDue && statusFilter ? 2 : 1;
      const fetchLimit = Math.min(filters.limit * overshoot, 1000);

      const rows = await tx.query.invoices.findMany({
        where: and(...conds),
        orderBy: [order],
        limit: fetchLimit,
        offset: filters.offset,
      });

      // Resolve names + types for every row in one shot.
      const accountIds = uniqueIds(rows.map((r) => r.accountId));
      const customerIds = uniqueIds(rows.map((r) => r.customerId));
      const jobIds = uniqueIds(rows.map((r) => r.jobId));

      const acctRows = accountIds.length
        ? await tx.query.accounts.findMany({ where: inArray(accounts.id, accountIds) })
        : [];
      const acctMap = new Map(acctRows.map((a) => [a.id, a]));

      const custRows = customerIds.length
        ? await tx.query.customers.findMany({ where: inArray(customers.id, customerIds) })
        : [];
      const custMap = new Map(custRows.map((c) => [c.id, c]));

      const jobRows = jobIds.length
        ? await tx.query.jobs.findMany({ where: inArray(jobs.id, jobIds) })
        : [];
      const jobMap = new Map(jobRows.map((j) => [j.id, j]));

      const driverIds = uniqueIds(jobRows.map((j) => j.assignedDriverId));
      const driverRows = driverIds.length
        ? await tx.query.drivers.findMany({ where: inArray(drivers.id, driverIds) })
        : [];
      const driverMap = new Map(
        driverRows.map((d) => [d.id, `${d.firstName} ${d.lastName}`.trim()]),
      );

      const now = new Date();

      // Compose rows + compute past_due.
      let assembled: ArSearchRow[] = rows.map((r) => {
        const acct = r.accountId ? (acctMap.get(r.accountId) ?? null) : null;
        const cust = r.customerId ? (custMap.get(r.customerId) ?? null) : null;
        const job = r.jobId ? (jobMap.get(r.jobId) ?? null) : null;
        const driverId = job?.assignedDriverId ?? null;
        const driverIds = driverId ? [driverId] : [];
        const driverNames = driverId ? [driverMap.get(driverId) ?? 'Unknown'] : [];

        const threshold = resolveDelinquencyDays(
          acct?.delinquencyDaysThreshold ?? null,
          Boolean(acct),
          tenantDefaults,
        );
        const postedDate = r.issuedAt ?? r.createdAt;
        const ageDays = Math.floor((now.getTime() - postedDate.getTime()) / (1000 * 60 * 60 * 24));
        const daysOverdue = ageDays - threshold;
        const isOpen =
          r.balanceCents > 0 && ['issued', 'sent', 'partially_paid', 'overdue'].includes(r.status);
        const isPastDue = isOpen && daysOverdue >= 0;

        const customerType: ArSearchRow['customerType'] = !acct
          ? 'cash'
          : acct.isMotorClub
            ? 'motor_club'
            : acct.billingTerms === 'cod' || acct.billingTerms === 'prepay'
              ? 'direct_bill'
              : 'fleet';

        return {
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          status: r.status,
          isPastDue,
          daysOverdue: isOpen ? daysOverdue : 0,
          issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
          dueAt: r.dueAt ? r.dueAt.toISOString() : null,
          paidAt: r.paidAt ? r.paidAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          customerId: r.customerId,
          customerName: cust?.name ?? null,
          accountId: r.accountId,
          accountName: acct?.name ?? null,
          customerType,
          jobId: r.jobId,
          jobNumber: job?.jobNumber ?? null,
          driverIds,
          driverNames,
          subtotalCents: r.subtotalCents,
          taxCents: r.taxCents,
          totalCents: r.totalCents,
          paidCents: r.paidCents,
          balanceCents: r.balanceCents,
        };
      });

      // Apply the past_due app-side filter if requested.
      if (statusFilter && wantsPastDue && realStatuses.length === 4) {
        // wantsPastDue ALONE (we expanded realStatuses to the 4 open
        // states above) — drop rows that aren't past_due.
        assembled = assembled.filter((r) => r.isPastDue);
      } else if (statusFilter && wantsPastDue) {
        // Mixed: keep rows that match real statuses OR are past_due.
        assembled = assembled.filter(
          (r) =>
            statusFilter.includes(r.status as never) ||
            (r.isPastDue && statusFilter.includes('past_due')),
        );
      }

      // Apply limit after past_due filtering so the page renders the
      // expected number of rows.
      const paginated = assembled.slice(0, filters.limit);

      const summary = paginated.reduce(
        (acc, r) => {
          acc.invoiceCount += 1;
          acc.totalBilledCents += r.totalCents;
          acc.totalPaidCents += r.paidCents;
          acc.totalOutstandingCents += r.balanceCents;
          if (r.isPastDue) acc.totalPastDueCents += r.balanceCents;
          return acc;
        },
        {
          invoiceCount: 0,
          totalBilledCents: 0,
          totalPaidCents: 0,
          totalOutstandingCents: 0,
          totalPastDueCents: 0,
        },
      );

      return {
        rows: paginated,
        total,
        limit: filters.limit,
        offset: filters.offset,
        summary,
      };
    });
  }

  /**
   * Public — used by the RED ALERT cron + reports. Returns every
   * past_due invoice for the tenant, no filters, full detail. Same
   * threshold semantics as search().
   */
  async listPastDueInvoices(ctx: CallerContext): Promise<ArSearchRow[]> {
    const result = await this.search(ctx, {
      statuses: ['past_due'],
      dateField: 'issued_at',
      limit: 500,
      offset: 0,
      sortBy: 'balance_cents',
      sortDir: 'desc',
    });
    return result.rows;
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

function uniqueIds(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return Array.from(set);
}
