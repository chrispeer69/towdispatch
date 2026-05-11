/**
 * SavedReportsService — CRUD for saved_reports + report_schedules.
 *
 * Tenant scoping is RLS; the service double-checks the owner_user_id when
 * loading user-private rows (an Auditor reading another user's row is fine —
 * RLS allows it inside the same tenant — but `delete` is owner-only).
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  reportSchedules,
  savedReports,
  uuidv7,
} from '@towcommand/db';
import {
  ERROR_CODES,
  type ReportScheduleDto,
  type SaveReportPayload,
  type SavedReportDto,
  type ScheduleReportPayload,
} from '@towcommand/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface Ctx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

@Injectable()
export class SavedReportsService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: Ctx): Promise<SavedReportDto[]> {
    return this.db.runInTenantContext(this.txCtx(ctx), async (tx) => {
      const rows = await tx.query.savedReports.findMany({
        where: and(isNull(savedReports.deletedAt)),
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      });
      return rows.map(toSavedDto);
    });
  }

  async save(ctx: Ctx, input: SaveReportPayload): Promise<SavedReportDto> {
    return this.db.runInTenantContext(this.txCtx(ctx), async (tx) => {
      const id = uuidv7();
      const [row] = await tx
        .insert(savedReports)
        .values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          description: input.description ?? null,
          reportId: input.reportId,
          filters: input.filters as unknown as object,
          ownerUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('saved_reports insert returned no row');
      return toSavedDto(row);
    });
  }

  async delete(ctx: Ctx, id: string): Promise<void> {
    await this.db.runInTenantContext(this.txCtx(ctx), async (tx) => {
      const row = await tx.query.savedReports.findFirst({
        where: and(eq(savedReports.id, id), isNull(savedReports.deletedAt)),
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Saved report not found',
        });
      }
      if (row.ownerUserId !== ctx.userId && !isPrivileged(ctx.role)) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Only the owner or an admin can delete this saved report',
        });
      }
      await tx
        .update(savedReports)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(savedReports.id, id));
    });
  }

  async schedule(ctx: Ctx, input: ScheduleReportPayload): Promise<ReportScheduleDto> {
    return this.db.runInTenantContext(this.txCtx(ctx), async (tx) => {
      const saved = await tx.query.savedReports.findFirst({
        where: and(eq(savedReports.id, input.savedReportId), isNull(savedReports.deletedAt)),
      });
      if (!saved) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Saved report not found',
        });
      }
      const id = uuidv7();
      const nextRunAt = computeNextRun(input.cadence, input.hourUtc, new Date());
      const [row] = await tx
        .insert(reportSchedules)
        .values({
          id,
          tenantId: ctx.tenantId,
          savedReportId: input.savedReportId,
          cadence: input.cadence,
          hourUtc: input.hourUtc,
          format: input.format,
          recipients: input.recipients as unknown as object,
          nextRunAt,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('report_schedules insert returned no row');
      return toScheduleDto(row);
    });
  }

  async listSchedules(ctx: Ctx): Promise<ReportScheduleDto[]> {
    return this.db.runInTenantContext(this.txCtx(ctx), async (tx) => {
      const rows = await tx.query.reportSchedules.findMany({
        where: and(isNull(reportSchedules.deletedAt)),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      return rows.map(toScheduleDto);
    });
  }

  async cancelSchedule(ctx: Ctx, id: string): Promise<void> {
    await this.db.runInTenantContext(this.txCtx(ctx), async (tx) => {
      const row = await tx.query.reportSchedules.findFirst({
        where: and(eq(reportSchedules.id, id), isNull(reportSchedules.deletedAt)),
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Schedule not found',
        });
      }
      await tx
        .update(reportSchedules)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(reportSchedules.id, id));
    });
  }

  private txCtx(ctx: Ctx): {
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

function toSavedDto(row: typeof savedReports.$inferSelect): SavedReportDto {
  return {
    id: row.id,
    name: row.name,
    reportId: row.reportId as SavedReportDto['reportId'],
    description: row.description,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toScheduleDto(row: typeof reportSchedules.$inferSelect): ReportScheduleDto {
  return {
    id: row.id,
    savedReportId: row.savedReportId,
    cadence: row.cadence as ReportScheduleDto['cadence'],
    hourUtc: row.hourUtc,
    format: row.format as ReportScheduleDto['format'],
    recipients: Array.isArray(row.recipients) ? (row.recipients as string[]) : [],
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isPrivileged(role: string | null): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Next-run computation: anchor to the requested UTC hour today; if that
 * time has already passed, advance by the cadence.
 */
export function computeNextRun(
  cadence: 'daily' | 'weekly' | 'monthly',
  hourUtc: number,
  now: Date,
): Date {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    if (cadence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
    else if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
