/**
 * KpiService — KPI dashboard catalog, per-widget compute, and per-user layout.
 *
 *   - catalog()       — the global kpi_widget_catalog rows.
 *   - compute(id,cfg) — resolve the widget compute fn and run it in the
 *                       caller's RLS-bound tenant transaction.
 *   - getLayout()     — the caller's saved layout, or a generated default.
 *   - putLayout()     — upsert the caller's layout (one row per tenant+user).
 */
import { Injectable } from '@nestjs/common';
import { kpiDashboardLayouts, uuidv7 } from '@ustowdispatch/db';
import {
  type KpiLayoutDto,
  type KpiLayoutEntry,
  type KpiValueDto,
  type KpiWidgetCatalogDto,
  type KpiWidgetId,
  kpiWidgetIdValues,
} from '@ustowdispatch/shared';
import { and, eq } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { type KpiTx, WIDGET_COMPUTE, WIDGET_LABELS } from './kpi-widgets.js';

@Injectable()
export class KpiService {
  constructor(private readonly db: TenantAwareDb) {}

  async catalog(ctx: AuthCtx): Promise<KpiWidgetCatalogDto[]> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.kpiWidgetCatalog.findMany();
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        defaultW: r.defaultW,
        defaultH: r.defaultH,
        configSchema: (r.configSchema as Record<string, unknown>) ?? {},
      }));
    });
  }

  async compute(
    ctx: AuthCtx,
    widgetId: KpiWidgetId,
    config: Record<string, unknown>,
  ): Promise<KpiValueDto> {
    const fn = WIDGET_COMPUTE[widgetId];
    const computed = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      fn(tx as unknown as KpiTx, ctx.tenantId, config),
    );
    return {
      widgetId,
      label: WIDGET_LABELS[widgetId],
      value: computed.value,
      unit: computed.unit,
      deltaPct: computed.deltaPct,
      tone: computed.tone,
      series: computed.series,
      generatedAt: new Date().toISOString(),
      note: computed.note,
    };
  }

  async getLayout(ctx: AuthCtx): Promise<KpiLayoutDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.kpiDashboardLayouts.findFirst({
        where: and(
          eq(kpiDashboardLayouts.tenantId, ctx.tenantId),
          eq(kpiDashboardLayouts.userId, ctx.userId),
        ),
      });
      if (!row) {
        return { layout: defaultLayout(), isDefault: true, updatedAt: null };
      }
      return {
        layout: row.layout as KpiLayoutEntry[],
        isDefault: row.isDefault,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async putLayout(ctx: AuthCtx, layout: KpiLayoutEntry[]): Promise<KpiLayoutDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.kpiDashboardLayouts.findFirst({
        where: and(
          eq(kpiDashboardLayouts.tenantId, ctx.tenantId),
          eq(kpiDashboardLayouts.userId, ctx.userId),
        ),
      });
      if (existing) {
        await tx
          .update(kpiDashboardLayouts)
          .set({ layout, updatedAt: new Date() })
          .where(eq(kpiDashboardLayouts.id, existing.id));
      } else {
        await tx.insert(kpiDashboardLayouts).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          layout,
          isDefault: false,
        });
      }
      const fresh = await tx.query.kpiDashboardLayouts.findFirst({
        where: and(
          eq(kpiDashboardLayouts.tenantId, ctx.tenantId),
          eq(kpiDashboardLayouts.userId, ctx.userId),
        ),
      });
      return {
        layout: (fresh?.layout as KpiLayoutEntry[]) ?? layout,
        isDefault: fresh?.isDefault ?? false,
        updatedAt: fresh?.updatedAt.toISOString() ?? new Date().toISOString(),
      };
    });
  }
}

/** A sensible starting grid: 3 columns of single-cell widgets, top-N wider. */
function defaultLayout(): KpiLayoutEntry[] {
  const cols = 3;
  const cellW = 4; // 12-col grid / 3
  return kpiWidgetIdValues.map((widgetId, i) => {
    const wide = widgetId.startsWith('top_5_');
    return {
      widgetId,
      x: (i % cols) * cellW,
      y: Math.floor(i / cols),
      w: wide ? 8 : cellW,
      h: 1,
      config: {},
    };
  });
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
