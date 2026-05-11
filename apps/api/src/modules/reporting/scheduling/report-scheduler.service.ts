/**
 * ReportSchedulerService — drives two recurring jobs:
 *
 *   1. mv-revenue-daily refresh (every 5 minutes)
 *   2. report-schedule dispatch (every 60 seconds — looks for schedules with
 *      next_run_at <= now and runs them)
 *
 * Decision (documented): the architecture earmarks BullMQ for cron-style
 * work but no workers were deployed at the time of Session 14. We
 * implement the scheduler as a NestJS-managed setInterval so deployment
 * stays single-process for now; when BullMQ ships, swap the setInterval
 * for repeatable BullMQ jobs without changing the work functions.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { reportSchedules, savedReports } from '@towcommand/db';
import type { ReportId } from '@towcommand/shared';
import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ADMIN_POOL } from '../../../database/database.tokens.js';
import { TenantAwareDb, type Tx } from '../../../database/tenant-aware-db.service.js';
import { EmailService } from '../../email/email.service.js';
import { ReportExportService } from '../export.service.js';
import { computeNextRun } from '../saved-reports.service.js';
import { DispatchReportService } from '../services/dispatch.report.service.js';
import { DriverReportService } from '../services/driver.report.service.js';
import { CommissionReportService } from '../services/commission.report.service.js';
import { ComplianceReportService } from '../services/compliance.report.service.js';
import { PnlReportService } from '../services/pnl.report.service.js';
import { RevenueReportService } from '../services/revenue.report.service.js';
import { StorageReportService } from '../services/storage.report.service.js';
import { TaxReportService } from '../services/tax.report.service.js';

const MV_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DISPATCH_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ReportSchedulerService implements OnModuleInit, OnModuleDestroy {
  private mvTimer?: NodeJS.Timeout;
  private dispatchTimer?: NodeJS.Timeout;

  constructor(
    @Inject(ADMIN_POOL) private readonly adminPool: Pool,
    private readonly db: TenantAwareDb,
    private readonly exporter: ReportExportService,
    private readonly email: EmailService,
    private readonly dispatch: DispatchReportService,
    private readonly driver: DriverReportService,
    private readonly revenue: RevenueReportService,
    private readonly storage: StorageReportService,
    private readonly pnl: PnlReportService,
    private readonly commission: CommissionReportService,
    private readonly tax: TaxReportService,
    private readonly compliance: ComplianceReportService,
  ) {}

  onModuleInit(): void {
    if (process.env.REPORTING_SCHEDULER_DISABLED === '1') return;
    this.mvTimer = setInterval(() => {
      this.refreshMvRevenueDaily().catch((err) => log('mv refresh failed', err));
    }, MV_REFRESH_INTERVAL_MS);
    this.dispatchTimer = setInterval(() => {
      this.dispatchSchedules().catch((err) => log('dispatch failed', err));
    }, DISPATCH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.mvTimer) clearInterval(this.mvTimer);
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
  }

  /**
   * Refresh the revenue MV. Uses CONCURRENTLY so consumers don't block.
   * Connects via the admin pool — only the owner role can refresh MVs.
   */
  async refreshMvRevenueDaily(): Promise<void> {
    const client = await this.adminPool.connect();
    try {
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_daily');
    } finally {
      client.release();
    }
  }

  /**
   * One tick of the dispatch loop. Each tenant's schedules are queried in a
   * tenant-scoped transaction (RLS handles isolation) — the loop here just
   * iterates tenant_ids that have due rows.
   */
  async dispatchSchedules(now: Date = new Date()): Promise<number> {
    let dispatched = 0;
    const tenants = await this.due(now);
    for (const tenantId of tenants) {
      try {
        await this.runForTenant(tenantId, now);
        dispatched += 1;
      } catch (err) {
        log(`tenant ${tenantId} schedule run failed`, err);
      }
    }
    return dispatched;
  }

  private async due(now: Date): Promise<string[]> {
    // Pull DISTINCT tenant_id with at least one due schedule — uses admin
    // pool because we need to skip RLS to enumerate tenants.
    const client = await this.adminPool.connect();
    try {
      const r = await client.query<{ tenant_id: string }>(
        `SELECT DISTINCT tenant_id FROM report_schedules
         WHERE deleted_at IS NULL
           AND next_run_at IS NOT NULL
           AND next_run_at <= $1`,
        [now.toISOString()],
      );
      return r.rows.map((row) => row.tenant_id);
    } finally {
      client.release();
    }
  }

  private async runForTenant(tenantId: string, now: Date): Promise<void> {
    await this.db.runInTenantContext(
      {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
        requestId: `scheduler-${Date.now()}`,
      },
      async (tx) => {
        const due = await tx.query.reportSchedules.findMany({
          where: and(isNull(reportSchedules.deletedAt), lte(reportSchedules.nextRunAt, now)),
        });
        for (const sch of due) {
          const saved = await tx.query.savedReports.findFirst({
            where: and(eq(savedReports.id, sch.savedReportId), isNull(savedReports.deletedAt)),
          });
          if (!saved) continue;
          await this.dispatchOne(tx, tenantId, saved, sch, now);
        }
      },
    );
  }

  private async dispatchOne(
    tx: Tx,
    tenantId: string,
    saved: typeof savedReports.$inferSelect,
    sch: typeof reportSchedules.$inferSelect,
    now: Date,
  ): Promise<void> {
    const ctx = {
      tenantId,
      userId: saved.ownerUserId,
      requestId: `scheduler-${sch.id}`,
      ipAddress: null,
      userAgent: null,
      role: 'manager',
    };
    const filters = (saved.filters ?? {}) as Record<string, unknown> as any;
    const reportId = saved.reportId as ReportId;
    const built = await this.buildExportInput(reportId, ctx, filters);
    const exported = await this.exporter.export({
      tenantId,
      ownerUserId: saved.ownerUserId,
      reportId,
      reportTitle: saved.name,
      columns: built.columns,
      rows: built.rows,
      kpis: built.kpis,
      format: sch.format as 'csv' | 'pdf',
    });
    const recipients = Array.isArray(sch.recipients) ? (sch.recipients as string[]) : [];
    for (const to of recipients) {
      try {
        await this.email.sendScheduledReportEmail({
          to,
          reportName: saved.name,
          downloadUrl: exported.url,
          fileName: exported.filename,
          sizeBytes: exported.bytes,
          expiresAt: exported.expiresAt,
        });
      } catch (err) {
        log(`send to ${to} failed`, err);
      }
    }
    await tx
      .update(reportSchedules)
      .set({
        lastRunAt: now,
        nextRunAt: computeNextRun(sch.cadence as 'daily' | 'weekly' | 'monthly', sch.hourUtc, now),
        updatedAt: now,
      })
      .where(eq(reportSchedules.id, sch.id));
  }

  /**
   * Map a report id to the export payload (columns + rows + KPIs).
   */
  private async buildExportInput(
    reportId: ReportId,
    ctx: Parameters<DispatchReportService['summary']>[0],
    filters: any,
  ): Promise<{ columns: string[]; rows: (string | number | null)[][]; kpis: { label: string; value: string }[] }> {
    const f = {
      granularity: 'day' as const,
      comparison: 'none' as const,
      limit: 200,
      ...filters,
    };
    switch (reportId) {
      case 'dispatch': {
        const summary = await this.dispatch.summary(ctx, f);
        const page = await this.dispatch.list(ctx, f);
        return {
          columns: ['Dispatcher', 'Jobs', 'GOA', 'GOA rate', 'Avg call→dispatch (s)', 'Avg on-scene (s)'],
          rows: page.rows.map((r) => [
            r.dispatcherName,
            r.jobsTotal,
            r.goaCount,
            `${(r.goaRate * 100).toFixed(1)}%`,
            r.avgCallToDispatchSec ?? '',
            r.avgOnSceneSec ?? '',
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'driver': {
        const summary = await this.driver.summary(ctx, f);
        const page = await this.driver.list(ctx, f);
        return {
          columns: ['Driver', 'Jobs', 'Revenue ($)', 'On-time %', 'Rating', 'GOA rate'],
          rows: page.rows.map((r) => [
            r.driverName,
            r.jobsCompleted,
            (r.revenueCents / 100).toFixed(2),
            r.onTimePct == null ? '' : `${(r.onTimePct * 100).toFixed(0)}%`,
            r.avgRating ?? '',
            `${(r.goaRate * 100).toFixed(1)}%`,
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'revenue': {
        const summary = await this.revenue.summary(ctx, f);
        const page = await this.revenue.list(ctx, f);
        return {
          columns: ['Label', 'Revenue ($)', 'Invoices'],
          rows: page.rows.map((r) => [r.label, (r.revenueCents / 100).toFixed(2), r.jobs]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'storage': {
        const summary = await this.storage.summary(ctx, f);
        const page = await this.storage.list(ctx, f);
        return {
          columns: ['Vehicle', 'Job #', 'Days in yard', 'Accrued ($)', 'Invoiced ($)', 'Outstanding ($)'],
          rows: page.rows.map((r) => [
            r.vehicleLabel,
            r.jobNumber,
            r.daysInYard,
            (r.accruedFeesCents / 100).toFixed(2),
            (r.invoicedFeesCents / 100).toFixed(2),
            (r.outstandingCents / 100).toFixed(2),
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'pnl': {
        const summary = await this.pnl.summary(ctx, f);
        const page = await this.pnl.list(ctx, f);
        return {
          columns: ['Dimension', 'Revenue ($)', 'Commission ($)', 'Fuel ($)', 'Depreciation ($)', 'Motor club ($)', 'Net ($)'],
          rows: page.rows.map((r) => [
            r.label,
            (r.revenueCents / 100).toFixed(2),
            (r.driverCommissionCents / 100).toFixed(2),
            (r.fuelCostCents / 100).toFixed(2),
            (r.truckDepreciationCents / 100).toFixed(2),
            (r.motorClubFeesCents / 100).toFixed(2),
            (r.netCents / 100).toFixed(2),
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'commission': {
        const summary = await this.commission.summary(ctx, f);
        const page = await this.commission.list(ctx, f);
        return {
          columns: ['Driver', 'Pay period', 'Jobs', 'Gross ($)', 'Commission ($)', 'Net ($)'],
          rows: page.rows.map((r) => [
            r.driverName,
            r.payPeriodKey,
            r.jobsCount,
            (r.grossRevenueCents / 100).toFixed(2),
            (r.commissionBaseCents / 100).toFixed(2),
            (r.netCents / 100).toFixed(2),
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'tax': {
        const summary = await this.tax.summary(ctx, f);
        const page = await this.tax.list(ctx, f);
        return {
          columns: ['Jurisdiction', 'Tax', 'Taxable ($)', 'Tax collected ($)', 'Exempt ($)', 'Invoices'],
          rows: page.rows.map((r) => [
            r.jurisdiction,
            r.taxName,
            (r.taxableSalesCents / 100).toFixed(2),
            (r.taxCollectedCents / 100).toFixed(2),
            (r.exemptSalesCents / 100).toFixed(2),
            r.invoiceCount,
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
      case 'compliance': {
        const summary = await this.compliance.summary(ctx, f);
        const page = await this.compliance.list(ctx, f);
        return {
          columns: ['Category', 'Subject', 'Detail', 'Days to breach', 'Severity'],
          rows: page.rows.map((r) => [
            r.category,
            r.subject,
            r.detail,
            r.daysToBreach ?? '',
            r.severity,
          ]),
          kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value })),
        };
      }
    }
  }
}

function log(msg: string, err?: unknown): void {
  process.stderr.write(`[reporting-scheduler] ${msg}${err ? ` :: ${String(err)}` : ''}\n`);
}
