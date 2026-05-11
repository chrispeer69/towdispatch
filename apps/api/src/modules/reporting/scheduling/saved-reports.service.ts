/**
 * SavedReportsService — CRUD over saved_reports + report_schedules.
 *
 *   - create()   — upsert by name. If a schedule is provided, attach (1:1).
 *   - list()     — all saved reports for the tenant, with their schedule (if any).
 *   - get()      — a single saved report with its schedule.
 *   - update()   — change filters, name, or schedule. Pass schedule:null to
 *                  detach an existing schedule.
 *   - remove()   — soft-delete the row (schedules cascade-delete via FK).
 *
 * Schedule next-run is computed by ScheduleClock; this service writes nextRunAt
 * on create/update so the poller picks it up.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { reportSchedules, savedReports, uuidv7 } from '@towcommand/db';
import type {
  CreateSavedReportPayload,
  ReportExportFormat,
  ReportId,
  ReportScheduleCadence,
  SavedReportDto,
  UpdateSavedReportPayload,
} from '@towcommand/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { computeNextRun } from './schedule-clock.js';

@Injectable()
export class SavedReportsService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: AuthCtx): Promise<SavedReportDto[]> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const reports = await tx.query.savedReports.findMany({
        where: and(eq(savedReports.tenantId, ctx.tenantId), isNull(savedReports.deletedAt)),
      });
      const schedules = await tx.query.reportSchedules.findMany({
        where: eq(reportSchedules.tenantId, ctx.tenantId),
      });
      const scheduleByReport = new Map(schedules.map((s) => [s.savedReportId, s]));
      return reports.map((r) => toDto(r, scheduleByReport.get(r.id) ?? null));
    });
  }

  async get(ctx: AuthCtx, id: string): Promise<SavedReportDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.query.savedReports.findFirst({
        where: and(eq(savedReports.id, id), isNull(savedReports.deletedAt)),
      });
      if (!r) throw new NotFoundException('Saved report not found');
      const s = await tx.query.reportSchedules.findFirst({
        where: eq(reportSchedules.savedReportId, id),
      });
      return toDto(r, s ?? null);
    });
  }

  async create(ctx: AuthCtx, payload: CreateSavedReportPayload): Promise<SavedReportDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const id = uuidv7();
      await tx.insert(savedReports).values({
        id,
        tenantId: ctx.tenantId,
        reportId: payload.reportId,
        name: payload.name,
        filters: payload.filters ?? {},
        createdBy: ctx.userId,
      });
      let scheduleRow: typeof reportSchedules.$inferSelect | null = null;
      if (payload.schedule) {
        const nextRunAt = computeNextRun(payload.schedule.cadence, new Date());
        const sid = uuidv7();
        await tx.insert(reportSchedules).values({
          id: sid,
          tenantId: ctx.tenantId,
          savedReportId: id,
          cadence: payload.schedule.cadence,
          format: payload.schedule.format,
          recipients: payload.schedule.recipients,
          active: true,
          nextRunAt,
        });
        scheduleRow =
          (await tx.query.reportSchedules.findFirst({
            where: eq(reportSchedules.id, sid),
          })) ?? null;
      }
      const row = await tx.query.savedReports.findFirst({
        where: eq(savedReports.id, id),
      });
      if (!row) throw new NotFoundException('Saved report not found after insert');
      return toDto(row, scheduleRow);
    });
  }

  async update(
    ctx: AuthCtx,
    id: string,
    payload: UpdateSavedReportPayload,
  ): Promise<SavedReportDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.query.savedReports.findFirst({
        where: and(eq(savedReports.id, id), isNull(savedReports.deletedAt)),
      });
      if (!r) throw new NotFoundException('Saved report not found');
      const patch: Partial<typeof savedReports.$inferInsert> = { updatedAt: new Date() };
      if (payload.name) patch.name = payload.name;
      if (payload.filters !== undefined) patch.filters = payload.filters;
      if (payload.reportId) patch.reportId = payload.reportId;
      await tx.update(savedReports).set(patch).where(eq(savedReports.id, id));

      if (payload.schedule !== undefined) {
        const existing = await tx.query.reportSchedules.findFirst({
          where: eq(reportSchedules.savedReportId, id),
        });
        if (payload.schedule === null) {
          if (existing) await tx.delete(reportSchedules).where(eq(reportSchedules.id, existing.id));
        } else if (existing) {
          const cadence = payload.schedule.cadence ?? (existing.cadence as ReportScheduleCadence);
          const format = payload.schedule.format ?? (existing.format as ReportExportFormat);
          const recipients = payload.schedule.recipients ?? (existing.recipients as string[]);
          await tx
            .update(reportSchedules)
            .set({
              cadence,
              format,
              recipients,
              nextRunAt: computeNextRun(cadence, new Date()),
              updatedAt: new Date(),
            })
            .where(eq(reportSchedules.id, existing.id));
        } else {
          await tx.insert(reportSchedules).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            savedReportId: id,
            cadence: payload.schedule.cadence,
            format: payload.schedule.format,
            recipients: payload.schedule.recipients,
            active: true,
            nextRunAt: computeNextRun(payload.schedule.cadence, new Date()),
          });
        }
      }
      return this.get(ctx, id);
    });
  }

  async remove(ctx: AuthCtx, id: string): Promise<void> {
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx.update(savedReports).set({ deletedAt: new Date() }).where(eq(savedReports.id, id));
    });
  }
}

function toDto(
  r: typeof savedReports.$inferSelect,
  s: typeof reportSchedules.$inferSelect | null,
): SavedReportDto {
  return {
    id: r.id,
    reportId: r.reportId as ReportId,
    name: r.name,
    filters: (r.filters as Record<string, unknown>) ?? {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    schedule:
      s === null
        ? null
        : {
            id: s.id,
            cadence: s.cadence as ReportScheduleCadence,
            format: s.format as ReportExportFormat,
            recipients: ((s.recipients as string[]) ?? []) as string[],
            nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
            lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
            active: s.active,
          },
  };
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
