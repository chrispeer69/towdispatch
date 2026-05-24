/**
 * ReportTemplateScheduler — the builder's scheduling lane (Session 53).
 *
 * SEPARATE from the Session 14 ReportScheduler (which drives report_schedules
 * off saved_reports). This one scans report_template_schedules every 5 minutes,
 * renders the template to a file, emails the recipients a signed link, and
 * advances next_run_at. Gated by REPORT_SCHEDULER_CRON_ENABLED (default false)
 * so dev/CI never render or email. Failures retry 3× with exponential backoff;
 * the final failure is recorded on the schedule + as a failed run row.
 *
 * Discovery uses the admin pool (cross-tenant read), then re-enters each
 * tenant's RLS context for the render/email/log work.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { reportTemplateRuns, reportTemplateSchedules, uuidv7 } from '@ustowdispatch/db';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ConfigService } from '../../../config/config.service.js';
import { ADMIN_POOL } from '../../../database/database.tokens.js';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { EmailService } from '../../email/email.service.js';
import { ReportExportService } from '../export/report-export.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { computeTemplateNextRun } from './next-run.js';
import { ReportBuilderService } from './report-builder.service.js';

const TICK_MS = 5 * 60_000;
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const MAX_ATTEMPTS = 3;

interface DueRow {
  id: string;
  tenant_id: string;
  template_id: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  delivery_at_local: string;
  delivery_dow: number | null;
  delivery_dom: number | null;
  format: 'csv' | 'pdf';
  recipients: string[];
}

@Injectable()
export class ReportTemplateScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReportTemplateScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly builder: ReportBuilderService,
    private readonly exporter: ReportExportService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(ADMIN_POOL) private readonly adminPool: Pool,
  ) {}

  onModuleInit(): void {
    if (!this.config.reportSchedulerCronEnabled) {
      this.log.log('report template scheduler disabled by env');
      return;
    }
    this.timer = setInterval(() => void this.tickSafe(), TICK_MS);
    setTimeout(() => void this.tickSafe(), 5_000);
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
      this.log.error(`template scheduler tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Public so a test harness can tick deterministically. */
  async tick(now: Date = new Date()): Promise<number> {
    const client = await this.adminPool.connect();
    let due: DueRow[] = [];
    try {
      const res = await client.query<DueRow>(
        `SELECT s.id, s.tenant_id, s.template_id, s.cadence, s.delivery_at_local,
                s.delivery_dow, s.delivery_dom, s.format, (s.recipients)::jsonb AS recipients
           FROM report_template_schedules s
          WHERE s.enabled = true
            AND s.deleted_at IS NULL
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

    let executed = 0;
    for (const row of due) {
      const ctx: AuthCtx = {
        tenantId: row.tenant_id,
        userId: SYSTEM_USER_ID,
        requestId: `tmpl-sched-${row.id}`,
        ipAddress: null,
        userAgent: 'report-template-scheduler',
        role: 'admin',
      };
      try {
        await this.runWithRetry(ctx, row);
        executed++;
      } catch (err) {
        this.log.error(`template schedule ${row.id} failed: ${(err as Error).message}`);
        await this.advance(ctx, row, 'failed', (err as Error).message);
      }
    }
    return executed;
  }

  private async runWithRetry(ctx: AuthCtx, row: DueRow): Promise<void> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.runOnce(ctx, row);
        await this.advance(ctx, row, 'succeeded', null);
        return;
      } catch (err) {
        lastErr = err as Error;
        this.log.warn(`template ${row.template_id} attempt ${attempt} failed: ${lastErr.message}`);
        if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 250);
      }
    }
    throw lastErr ?? new Error('unknown scheduler failure');
  }

  private async runOnce(ctx: AuthCtx, row: DueRow): Promise<void> {
    const runId = uuidv7();
    const startedAt = new Date();
    const tmpl = await this.builder.getTemplate(ctx, row.template_id);
    const result = await this.builder.execute(ctx, row.template_id);
    const out = await this.exporter.exportTabular(
      ctx.tenantId,
      tmpl.name,
      result.columns,
      result.rows,
      row.format,
    );
    for (const to of row.recipients) {
      try {
        await this.email.sendScheduledReport({
          to,
          reportName: tmpl.name,
          reportTitle: tmpl.name,
          downloadUrl: out.url,
          format: row.format,
        });
      } catch (err) {
        this.log.warn(`scheduled-report email to ${to} failed: ${(err as Error).message}`);
      }
    }
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx.insert(reportTemplateRuns).values({
        id: runId,
        tenantId: ctx.tenantId,
        templateId: row.template_id,
        scheduleId: row.id,
        requestedByUserId: null,
        status: 'succeeded',
        format: row.format,
        rowCount: result.rows.length,
        storageKey: out.key,
        startedAt,
        completedAt: new Date(),
      });
    });
  }

  private async advance(
    ctx: AuthCtx,
    row: DueRow,
    status: 'succeeded' | 'failed',
    error: string | null,
  ): Promise<void> {
    const nextRunAt = computeTemplateNextRun(
      {
        cadence: row.cadence,
        deliveryAtLocal: row.delivery_at_local,
        deliveryDow: row.delivery_dow,
        deliveryDom: row.delivery_dom,
      },
      new Date(),
    );
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx
        .update(reportTemplateSchedules)
        .set({
          lastRunAt: new Date(),
          lastStatus: status,
          lastError: error ? error.slice(0, 1000) : null,
          nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(reportTemplateSchedules.id, row.id));
      if (status === 'failed') {
        await tx.insert(reportTemplateRuns).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          templateId: row.template_id,
          scheduleId: row.id,
          requestedByUserId: null,
          status: 'failed',
          format: row.format,
          rowCount: 0,
          errorText: error ? error.slice(0, 1000) : 'unknown',
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
