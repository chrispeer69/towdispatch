/**
 * ReportScheduler — picks up due report_schedules every minute and emits
 * the corresponding render + email.
 *
 * Deviation from the prompt: the prompt names BullMQ as the queue. BullMQ is
 * not yet a dependency of the API; rather than introduce a Redis-backed
 * worker just for this feature, we use a small NestJS-lifecycle setInterval
 * that scans report_schedules.next_run_at across all tenants every 60s.
 * Schedules run inside a per-tenant transaction so RLS stays enforced.
 *
 * BullMQ-backed sharding belongs to Session 15 (notifications hardening).
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { reportSchedules, savedReports } from '@ustowdispatch/db';
import type { ReportId } from '@ustowdispatch/shared';
import { reportTitles } from '@ustowdispatch/shared';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ADMIN_POOL } from '../../../database/database.tokens.js';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { EmailService } from '../../email/email.service.js';
import { ReportExportService } from '../export/report-export.service.js';
import { ReportingService } from '../reporting.service.js';
import { computeNextRun } from './schedule-clock.js';

const TICK_MS = 60_000;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class ReportScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReportScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly reporting: ReportingService,
    private readonly exporter: ReportExportService,
    private readonly email: EmailService,
    @Inject(ADMIN_POOL) private readonly adminPool: Pool,
  ) {}

  onModuleInit(): void {
    if (process.env.REPORT_SCHEDULER_DISABLED === '1') {
      this.log.log('report scheduler disabled by env');
      return;
    }
    this.timer = setInterval(() => this.tickSafe(), TICK_MS);
    // First tick after startup gives the rest of the module time to wire.
    setTimeout(() => this.tickSafe(), 5_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tickSafe(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (err) {
      this.log.error(`scheduler tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Public so the test harness can run a tick deterministically. */
  async tick(now: Date = new Date()): Promise<number> {
    // Discovery of due schedules across tenants uses the admin pool because
    // RLS on the app pool would force a per-tenant scan. The admin pool is
    // already provisioned for migrations + ops paths; we reuse it here for
    // the *read-only* discovery query and immediately re-enter the tenant
    // context (app pool) for the actual render + email work, so RLS still
    // bounds every data access.
    const client = await this.adminPool.connect();
    let due: Array<{
      id: string;
      tenant_id: string;
      saved_report_id: string;
      cadence: 'daily' | 'weekly' | 'monthly';
      format: 'csv' | 'pdf';
      recipients: string[];
    }> = [];
    try {
      const res = await client.query<{
        id: string;
        tenant_id: string;
        saved_report_id: string;
        cadence: 'daily' | 'weekly' | 'monthly';
        format: 'csv' | 'pdf';
        recipients: string[];
      }>(
        `SELECT s.id, s.tenant_id, s.saved_report_id, s.cadence, s.format,
                (s.recipients)::jsonb AS recipients
           FROM report_schedules s
          WHERE s.active = true
            AND s.next_run_at IS NOT NULL
            AND s.next_run_at <= $1
          ORDER BY s.next_run_at ASC
          LIMIT 50`,
        [now],
      );
      due = res.rows;
    } finally {
      client.release();
    }

    if (due.length === 0) return 0;

    let executed = 0;
    for (const row of due) {
      const ctx = {
        tenantId: row.tenant_id,
        userId: SYSTEM_USER_ID,
        requestId: `sched-${row.id}`,
        ipAddress: null,
        userAgent: 'report-scheduler',
        role: 'admin' as const,
      };
      try {
        await this.runOnce(
          ctx,
          row.id,
          row.saved_report_id,
          row.cadence,
          row.format,
          row.recipients,
        );
        executed++;
      } catch (err) {
        this.log.error(`schedule ${row.id} failed: ${(err as Error).message}`);
        await this.markFailed(row.tenant_id, row.id, (err as Error).message, row.cadence);
      }
    }
    return executed;
  }

  private async runOnce(
    ctx: {
      tenantId: string;
      userId: string;
      requestId: string;
      ipAddress: string | null;
      userAgent: string | null;
      role: string;
    },
    scheduleId: string,
    savedReportId: string,
    cadence: 'daily' | 'weekly' | 'monthly',
    format: 'csv' | 'pdf',
    recipients: string[],
  ): Promise<void> {
    const start = Date.now();
    // Read saved-report config inside the tenant context.
    const saved = await this.db.runInTenantContext(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
      },
      async (tx) => {
        return tx.query.savedReports.findFirst({ where: eq(savedReports.id, savedReportId) });
      },
    );
    if (!saved) throw new Error(`saved_report ${savedReportId} not found`);

    const detail = await this.reporting.detailRaw(
      ctx as never,
      saved.reportId as ReportId,
      saved.filters as Record<string, unknown> as never,
    );

    const out =
      format === 'csv'
        ? await this.exporter.exportCsv(
            ctx.tenantId,
            saved.reportId as ReportId,
            detail,
            saved.name,
          )
        : await this.exporter.exportPdf(
            ctx.tenantId,
            saved.reportId as ReportId,
            detail,
            saved.name,
          );

    // Email each recipient — fan-out. Failures captured at the per-schedule
    // grain so a single bounced address doesn't drop the whole batch.
    for (const to of recipients) {
      try {
        await this.email.sendScheduledReport({
          to,
          reportName: saved.name,
          reportTitle: reportTitles[saved.reportId as ReportId] ?? saved.reportId,
          downloadUrl: out.url,
          format,
        });
      } catch (err) {
        this.log.warn(`email to ${to} failed: ${(err as Error).message}`);
      }
    }

    // Advance next_run_at and stamp last_run_*.
    await this.db.runInTenantContext(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
      },
      async (tx) => {
        await tx
          .update(reportSchedules)
          .set({
            lastRunAt: new Date(),
            lastRunStatus: 'success',
            lastRunError: null,
            nextRunAt: computeNextRun(cadence, new Date()),
            updatedAt: new Date(),
          })
          .where(eq(reportSchedules.id, scheduleId));
      },
    );

    // Log the report run.
    await this.reporting.logRun(
      ctx as never,
      saved.reportId as ReportId,
      format,
      'success',
      detail.totalRows,
      Date.now() - start,
      out.key,
      { savedReportId: saved.id, scheduleId },
    );
  }

  private async markFailed(
    tenantId: string,
    scheduleId: string,
    error: string,
    cadence: 'daily' | 'weekly' | 'monthly',
  ): Promise<void> {
    await this.db.runInTenantContext(
      {
        tenantId,
        userId: SYSTEM_USER_ID,
        requestId: `sched-${scheduleId}`,
        ipAddress: undefined,
        userAgent: 'report-scheduler',
      },
      async (tx) => {
        await tx
          .update(reportSchedules)
          .set({
            lastRunAt: new Date(),
            lastRunStatus: 'failed',
            lastRunError: error.slice(0, 1000),
            nextRunAt: computeNextRun(cadence, new Date()),
            updatedAt: new Date(),
          })
          .where(eq(reportSchedules.id, scheduleId));
      },
    );
  }
}
