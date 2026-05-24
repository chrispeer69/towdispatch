/**
 * ReportBuilderService — CRUD + execution for the custom report builder.
 *
 *   - createTemplate / listTemplates / getTemplate / updateTemplate /
 *     removeTemplate (soft-delete) over report_templates.
 *   - putSchedule / removeSchedule over report_template_schedules (1:1).
 *   - preview(body)  — ad-hoc compile + run, not persisted.
 *   - execute(id)    — run a saved template, return rows (capped).
 *   - runNow(id, fmt)— run + render a file + log a report_template_run.
 *   - listRuns / getRun — run history with signed download links.
 *
 * Every template spec is validated against the entity registry (via the
 * compiler) on save and on run; an unknown field is a 400, never SQL.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  reportTemplateRuns,
  reportTemplateSchedules,
  reportTemplates,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type ExecuteReportResult,
  REPORT_ROW_CAP,
  type ReportFilter,
  type ReportSort,
  type ReportTemplateBody,
  type ReportTemplateDto,
  type ReportTemplateRunDto,
  type ReportTemplateScheduleBody,
  type UpdateReportTemplatePayload,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { ReportExportService } from '../export/report-export.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { computeTemplateNextRun } from './next-run.js';
import {
  type CompileInput,
  type CompiledColumn,
  ReportCompileError,
  compileReport,
} from './report-compiler.js';

type TemplateRow = typeof reportTemplates.$inferSelect;
type ScheduleRow = typeof reportTemplateSchedules.$inferSelect;

interface TemplateSpec {
  baseEntity: ReportTemplateBody['baseEntity'];
  selectedFields: string[];
  filters: ReportFilter[];
  groupBy: string[];
  sort: ReportSort[];
}

@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly exporter: ReportExportService,
  ) {}

  // ---------------------------------------------------------------- templates

  async listTemplates(ctx: AuthCtx): Promise<ReportTemplateDto[]> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.reportTemplates.findMany({
        where: and(eq(reportTemplates.tenantId, ctx.tenantId), isNull(reportTemplates.deletedAt)),
      });
      const schedules = await tx.query.reportTemplateSchedules.findMany({
        where: and(
          eq(reportTemplateSchedules.tenantId, ctx.tenantId),
          isNull(reportTemplateSchedules.deletedAt),
        ),
      });
      const byTemplate = new Map(schedules.map((s) => [s.templateId, s]));
      // Visibility: own templates + tenant-shared templates.
      return rows
        .filter((r) => r.isSharedWithTenant || r.createdBy === ctx.userId)
        .map((r) => toTemplateDto(r, byTemplate.get(r.id) ?? null));
    });
  }

  async getTemplate(ctx: AuthCtx, id: string): Promise<ReportTemplateDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await this.requireTemplate(tx, id);
      const sched = await tx.query.reportTemplateSchedules.findFirst({
        where: and(
          eq(reportTemplateSchedules.templateId, id),
          isNull(reportTemplateSchedules.deletedAt),
        ),
      });
      return toTemplateDto(row, sched ?? null);
    });
  }

  async createTemplate(ctx: AuthCtx, body: ReportTemplateBody): Promise<ReportTemplateDto> {
    this.validateSpec(body, ctx.tenantId);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const id = uuidv7();
      await tx.insert(reportTemplates).values({
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        description: body.description ?? null,
        baseEntity: body.baseEntity,
        selectedFields: body.selectedFields,
        filters: body.filters,
        groupBy: body.groupBy,
        sort: body.sort,
        isSharedWithTenant: body.isSharedWithTenant,
        createdBy: ctx.userId,
      });
      const row = await this.requireTemplate(tx, id);
      return toTemplateDto(row, null);
    });
  }

  async updateTemplate(
    ctx: AuthCtx,
    id: string,
    body: UpdateReportTemplatePayload,
  ): Promise<ReportTemplateDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await this.requireTemplate(tx, id);
      const merged: TemplateSpec = {
        baseEntity: body.baseEntity ?? (row.baseEntity as TemplateSpec['baseEntity']),
        selectedFields: body.selectedFields ?? (row.selectedFields as string[]),
        filters: body.filters ?? (row.filters as ReportFilter[]),
        groupBy: body.groupBy ?? (row.groupBy as string[]),
        sort: body.sort ?? (row.sort as ReportSort[]),
      };
      this.validateSpec(merged, ctx.tenantId);

      const patch: Partial<typeof reportTemplates.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.description !== undefined) patch.description = body.description ?? null;
      if (body.baseEntity !== undefined) patch.baseEntity = body.baseEntity;
      if (body.selectedFields !== undefined) patch.selectedFields = body.selectedFields;
      if (body.filters !== undefined) patch.filters = body.filters;
      if (body.groupBy !== undefined) patch.groupBy = body.groupBy;
      if (body.sort !== undefined) patch.sort = body.sort;
      if (body.isSharedWithTenant !== undefined) patch.isSharedWithTenant = body.isSharedWithTenant;
      await tx.update(reportTemplates).set(patch).where(eq(reportTemplates.id, id));

      const fresh = await this.requireTemplate(tx, id);
      const sched = await tx.query.reportTemplateSchedules.findFirst({
        where: and(
          eq(reportTemplateSchedules.templateId, id),
          isNull(reportTemplateSchedules.deletedAt),
        ),
      });
      return toTemplateDto(fresh, sched ?? null);
    });
  }

  async removeTemplate(ctx: AuthCtx, id: string): Promise<void> {
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await this.requireTemplate(tx, id);
      await tx
        .update(reportTemplates)
        .set({ deletedAt: new Date() })
        .where(eq(reportTemplates.id, id));
    });
  }

  // ---------------------------------------------------------------- schedules

  async putSchedule(
    ctx: AuthCtx,
    templateId: string,
    body: ReportTemplateScheduleBody,
  ): Promise<ReportTemplateDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await this.requireTemplate(tx, templateId);
      const nextRunAt = computeTemplateNextRun(
        {
          cadence: body.cadence,
          deliveryAtLocal: body.deliveryAtLocal,
          deliveryDow: body.deliveryDow ?? null,
          deliveryDom: body.deliveryDom ?? null,
        },
        new Date(),
      );
      const existing = await tx.query.reportTemplateSchedules.findFirst({
        where: and(
          eq(reportTemplateSchedules.templateId, templateId),
          isNull(reportTemplateSchedules.deletedAt),
        ),
      });
      if (existing) {
        await tx
          .update(reportTemplateSchedules)
          .set({
            cadence: body.cadence,
            deliveryAtLocal: body.deliveryAtLocal,
            deliveryDow: body.deliveryDow ?? null,
            deliveryDom: body.deliveryDom ?? null,
            recipients: body.recipients,
            format: body.format,
            enabled: body.enabled,
            nextRunAt,
            updatedAt: new Date(),
          })
          .where(eq(reportTemplateSchedules.id, existing.id));
      } else {
        await tx.insert(reportTemplateSchedules).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          templateId,
          cadence: body.cadence,
          deliveryAtLocal: body.deliveryAtLocal,
          deliveryDow: body.deliveryDow ?? null,
          deliveryDom: body.deliveryDom ?? null,
          recipients: body.recipients,
          format: body.format,
          enabled: body.enabled,
          nextRunAt,
        });
      }
      return this.getTemplateTx(tx, ctx, templateId);
    });
  }

  async removeSchedule(ctx: AuthCtx, templateId: string): Promise<void> {
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx
        .update(reportTemplateSchedules)
        .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(reportTemplateSchedules.templateId, templateId),
            isNull(reportTemplateSchedules.deletedAt),
          ),
        );
    });
  }

  // ---------------------------------------------------------------- execution

  /** Ad-hoc compile + run, not persisted (the builder preview pane). */
  async preview(ctx: AuthCtx, body: TemplateSpec): Promise<ExecuteReportResult> {
    return this.run(ctx, null, body);
  }

  /** Run a saved template synchronously, capped at REPORT_ROW_CAP. */
  async execute(ctx: AuthCtx, templateId: string): Promise<ExecuteReportResult> {
    const spec = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await this.requireTemplate(tx, templateId);
      return specFromRow(row);
    });
    return this.run(ctx, templateId, spec);
  }

  private async run(
    ctx: AuthCtx,
    templateId: string | null,
    spec: TemplateSpec,
  ): Promise<ExecuteReportResult> {
    const compiled = this.compile(spec, ctx.tenantId);
    const { rows, totalCount, truncated } = await this.db.runInTenantContext(
      toTenantCtx(ctx),
      async (tx) => {
        const countRes = await tx.execute<{ n: number }>(compiled.countSql);
        const total = Number(countRes.rows[0]?.n ?? 0);
        const rowsRes = await tx.execute<Record<string, unknown>>(compiled.rowsSql);
        const raw = rowsRes.rows ?? [];
        const isTruncated = raw.length > REPORT_ROW_CAP;
        const capped = raw.slice(0, REPORT_ROW_CAP).map((r) => coerceRow(compiled.columns, r));
        return { rows: capped, totalCount: total, truncated: isTruncated };
      },
    );
    return {
      templateId,
      generatedAt: new Date().toISOString(),
      columns: compiled.columns.map((c) => ({ key: c.key, label: c.label })),
      rows,
      totalCount,
      truncated,
      note: truncated
        ? `Result exceeds ${REPORT_ROW_CAP.toLocaleString('en-US')} rows; schedule this report to receive the full export by email.`
        : null,
    };
  }

  /** Run + render a file + log a report_template_run. */
  async runNow(
    ctx: AuthCtx,
    templateId: string,
    format: 'csv' | 'pdf',
  ): Promise<ReportTemplateRunDto> {
    const runId = uuidv7();
    const startedAt = new Date();
    const name = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await this.requireTemplate(tx, templateId);
      return row.name;
    });
    const result = await this.execute(ctx, templateId);

    try {
      const out = await this.exporter.exportTabular(
        ctx.tenantId,
        name,
        result.columns,
        result.rows,
        format,
      );
      const completedAt = new Date();
      await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
        await tx.insert(reportTemplateRuns).values({
          id: runId,
          tenantId: ctx.tenantId,
          templateId,
          requestedByUserId: ctx.userId,
          status: 'succeeded',
          format,
          rowCount: result.rows.length,
          storageKey: out.key,
          startedAt,
          completedAt,
        });
      });
      return {
        id: runId,
        templateId,
        scheduleId: null,
        status: 'succeeded',
        format,
        rowCount: result.rows.length,
        errorText: null,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        createdAt: completedAt.toISOString(),
        downloadUrl: out.url,
      };
    } catch (err) {
      const completedAt = new Date();
      await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
        await tx.insert(reportTemplateRuns).values({
          id: runId,
          tenantId: ctx.tenantId,
          templateId,
          requestedByUserId: ctx.userId,
          status: 'failed',
          format,
          rowCount: 0,
          errorText: (err as Error).message.slice(0, 1000),
          startedAt,
          completedAt,
        });
      });
      throw err;
    }
  }

  async listRuns(ctx: AuthCtx, templateId?: string): Promise<ReportTemplateRunDto[]> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const where = templateId
        ? and(
            eq(reportTemplateRuns.tenantId, ctx.tenantId),
            eq(reportTemplateRuns.templateId, templateId),
            isNull(reportTemplateRuns.deletedAt),
          )
        : and(eq(reportTemplateRuns.tenantId, ctx.tenantId), isNull(reportTemplateRuns.deletedAt));
      const rows = await tx.query.reportTemplateRuns.findMany({
        where,
        orderBy: [desc(reportTemplateRuns.createdAt)],
        limit: 50,
      });
      return rows.map((r) => this.toRunDto(ctx.tenantId, r));
    });
  }

  async getRun(ctx: AuthCtx, runId: string): Promise<ReportTemplateRunDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.reportTemplateRuns.findFirst({
        where: and(eq(reportTemplateRuns.id, runId), isNull(reportTemplateRuns.deletedAt)),
      });
      if (!row) throw new NotFoundException('Report run not found');
      return this.toRunDto(ctx.tenantId, row);
    });
  }

  // ---------------------------------------------------------------- internals

  private compile(spec: TemplateSpec, tenantId: string) {
    try {
      return compileReport({
        baseEntity: spec.baseEntity,
        selectedFields: spec.selectedFields,
        filters: spec.filters,
        groupBy: spec.groupBy,
        sort: spec.sort,
        tenantId,
        limit: REPORT_ROW_CAP,
      } satisfies CompileInput);
    } catch (err) {
      if (err instanceof ReportCompileError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Validate a spec compiles without running it (used on save). */
  private validateSpec(spec: TemplateSpec, tenantId: string): void {
    this.compile(spec, tenantId);
  }

  private async requireTemplate(
    tx: Parameters<Parameters<TenantAwareDb['runInTenantContext']>[1]>[0],
    id: string,
  ): Promise<TemplateRow> {
    const row = await tx.query.reportTemplates.findFirst({
      where: and(eq(reportTemplates.id, id), isNull(reportTemplates.deletedAt)),
    });
    if (!row) throw new NotFoundException('Report template not found');
    return row;
  }

  private async getTemplateTx(
    tx: Parameters<Parameters<TenantAwareDb['runInTenantContext']>[1]>[0],
    ctx: AuthCtx,
    id: string,
  ): Promise<ReportTemplateDto> {
    const row = await this.requireTemplate(tx, id);
    const sched = await tx.query.reportTemplateSchedules.findFirst({
      where: and(
        eq(reportTemplateSchedules.templateId, id),
        isNull(reportTemplateSchedules.deletedAt),
      ),
    });
    return toTemplateDto(row, sched ?? null);
  }

  private toRunDto(
    tenantId: string,
    r: typeof reportTemplateRuns.$inferSelect,
  ): ReportTemplateRunDto {
    return {
      id: r.id,
      templateId: r.templateId,
      scheduleId: r.scheduleId,
      status: r.status,
      format: r.format,
      rowCount: r.rowCount,
      errorText: r.errorText,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      downloadUrl:
        r.status === 'succeeded' && r.storageKey
          ? this.exporter.urlForKey(tenantId, r.storageKey)
          : null,
    };
  }
}

function specFromRow(row: TemplateRow): TemplateSpec {
  return {
    baseEntity: row.baseEntity as TemplateSpec['baseEntity'],
    selectedFields: row.selectedFields as string[],
    filters: row.filters as ReportFilter[],
    groupBy: row.groupBy as string[],
    sort: row.sort as ReportSort[],
  };
}

function coerceRow(
  columns: CompiledColumn[],
  row: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const c of columns) {
    const v = row[c.key];
    if (v === null || v === undefined) {
      out[c.key] = null;
      continue;
    }
    switch (c.kind) {
      case 'cents':
      case 'number':
        out[c.key] = typeof v === 'number' ? v : Number(v);
        break;
      case 'boolean':
        out[c.key] = Boolean(v);
        break;
      case 'date':
        out[c.key] = v instanceof Date ? v.toISOString() : String(v);
        break;
      default:
        out[c.key] = typeof v === 'number' ? v : String(v);
    }
  }
  return out;
}

function toTemplateDto(r: TemplateRow, s: ScheduleRow | null): ReportTemplateDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    baseEntity: r.baseEntity as ReportTemplateBody['baseEntity'],
    selectedFields: r.selectedFields as string[],
    filters: r.filters as ReportTemplateBody['filters'],
    groupBy: r.groupBy as string[],
    sort: r.sort as ReportTemplateBody['sort'],
    isSharedWithTenant: r.isSharedWithTenant,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    schedule:
      s === null
        ? null
        : {
            id: s.id,
            cadence: s.cadence,
            deliveryAtLocal: s.deliveryAtLocal,
            deliveryDow: s.deliveryDow,
            deliveryDom: s.deliveryDom,
            recipients: (s.recipients as string[]) ?? [],
            format: s.format,
            enabled: s.enabled,
            nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
            lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
            lastStatus: s.lastStatus ?? null,
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
