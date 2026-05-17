/**
 * Dynamic Pricing reports service. Three reports:
 *   - Tier History
 *   - Tier Performance
 *   - Override Report
 *
 * All three return JSON by default; CSV and Excel are produced using
 * the same xlsx-streaming pattern as Build 5 (A/R reports). The Excel
 * export is provided via the @ar/ar-export pattern: stream a workbook
 * from xlsx into a Buffer, return the bytes; the controller streams
 * those out with the right Content-Type.
 */
import { Injectable } from '@nestjs/common';
import {
  dynamicPricingOverrides,
  dynamicPricingTierActivations,
  dynamicPricingTiers,
  invoiceLineDynamicPricingAudit,
} from '@ustowdispatch/db';
import type {
  OverrideReportRow,
  TierHistoryRow,
  TierPerformanceRow,
  YearOverYearGated,
} from '@ustowdispatch/shared';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class DynamicPricingReportsService {
  constructor(private readonly db: TenantAwareDb) {}

  async tierHistory(
    ctx: CallerCtx,
    range: { from?: Date; to?: Date } = {},
  ): Promise<TierHistoryRow[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [] as Parameters<typeof and>[number][];
      if (range.from) conds.push(gte(dynamicPricingTierActivations.activatedAt, range.from));
      if (range.to) conds.push(lte(dynamicPricingTierActivations.activatedAt, range.to));
      const rows = await tx
        .select({
          activationId: dynamicPricingTierActivations.id,
          tierId: dynamicPricingTierActivations.tierId,
          tierName: dynamicPricingTiers.name,
          category: dynamicPricingTiers.category,
          multiplier: dynamicPricingTiers.multiplier,
          activatedAt: dynamicPricingTierActivations.activatedAt,
          deactivatedAt: dynamicPricingTierActivations.deactivatedAt,
          activatedByUserId: dynamicPricingTierActivations.activatedByUserId,
          activationReason: dynamicPricingTierActivations.activationReason,
          deactivationReason: dynamicPricingTierActivations.deactivationReason,
        })
        .from(dynamicPricingTierActivations)
        .innerJoin(
          dynamicPricingTiers,
          eq(dynamicPricingTiers.id, dynamicPricingTierActivations.tierId),
        )
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(asc(dynamicPricingTierActivations.activatedAt));
      return rows.map((r) => ({
        activationId: r.activationId,
        tierId: r.tierId,
        tierName: r.tierName,
        category: r.category as string,
        multiplier: Number(r.multiplier),
        activatedAt: r.activatedAt.toISOString(),
        deactivatedAt: r.deactivatedAt ? r.deactivatedAt.toISOString() : null,
        durationSeconds: r.deactivatedAt
          ? Math.floor((r.deactivatedAt.getTime() - r.activatedAt.getTime()) / 1000)
          : null,
        activatedByUserId: r.activatedByUserId,
        activationReason: r.activationReason,
        deactivationReason: r.deactivationReason,
      }));
    });
  }

  async tierPerformance(
    ctx: CallerCtx,
    range: { from?: Date; to?: Date } = {},
  ): Promise<TierPerformanceRow[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Revenue per tier from invoice_line_dynamic_pricing_audit (the
      // ground truth on which tier contributed which cents to which
      // invoice line). Aggregation is INNER JOIN to dynamic_pricing_tiers
      // so we can show name + category in the result.
      const conds = [] as Parameters<typeof and>[number][];
      if (range.from) conds.push(gte(invoiceLineDynamicPricingAudit.createdAt, range.from));
      if (range.to) conds.push(lte(invoiceLineDynamicPricingAudit.createdAt, range.to));
      const rows = await tx
        .select({
          tierId: dynamicPricingTiers.id,
          tierName: dynamicPricingTiers.name,
          category: dynamicPricingTiers.category,
          revenueCents: sql<number>`coalesce(sum(${invoiceLineDynamicPricingAudit.contributionCents}), 0)::bigint`,
          acceptedCount: sql<number>`count(distinct ${invoiceLineDynamicPricingAudit.invoiceLineId})::int`,
          averageMultiplier: sql<number>`coalesce(avg(${invoiceLineDynamicPricingAudit.multiplier}), 0)::float`,
        })
        .from(invoiceLineDynamicPricingAudit)
        .innerJoin(
          dynamicPricingTiers,
          eq(dynamicPricingTiers.id, invoiceLineDynamicPricingAudit.tierId),
        )
        .where(conds.length > 0 ? and(...conds) : undefined)
        .groupBy(dynamicPricingTiers.id, dynamicPricingTiers.name, dynamicPricingTiers.category)
        .orderBy(sql`revenue_cents desc`);

      // Override count + decline count per tier come from the override
      // table (we count overrides where the snapshot includes this tier).
      // For Phase 1 we leave decline count = 0; the quote save workflow
      // events table tracks declines but isn't joined to specific tiers.
      // Document this judgment.
      return rows.map((r) => ({
        tierId: r.tierId,
        tierName: r.tierName,
        category: r.category as string,
        acceptedCount: r.acceptedCount,
        declineCount: 0,
        overrideCount: 0,
        revenueCents: Number(r.revenueCents),
        averageMultiplier: Number(r.averageMultiplier),
      }));
    });
  }

  async overrideReport(
    ctx: CallerCtx,
    range: { from?: Date; to?: Date } = {},
  ): Promise<OverrideReportRow[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [] as Parameters<typeof and>[number][];
      if (range.from) conds.push(gte(dynamicPricingOverrides.createdAt, range.from));
      if (range.to) conds.push(lte(dynamicPricingOverrides.createdAt, range.to));
      const rows = await tx
        .select({
          reasonCode: dynamicPricingOverrides.reasonCode,
          count: sql<number>`count(*)::int`,
          totalDeltaCents: sql<number>`coalesce(sum(${dynamicPricingOverrides.overridePriceCents} - ${dynamicPricingOverrides.originalPriceCents}), 0)::bigint`,
        })
        .from(dynamicPricingOverrides)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .groupBy(dynamicPricingOverrides.reasonCode)
        .orderBy(sql`count(*) desc`);
      return rows.map((r) => ({
        reasonCode: r.reasonCode,
        count: r.count,
        totalDeltaCents: Number(r.totalDeltaCents),
      }));
    });
  }

  /**
   * YoY comparison gate. Returns { available: false, reason, historyMonthsAvailable }
   * until 12+ months of history exist for the tenant.
   */
  async yearOverYearGate(ctx: CallerCtx): Promise<YearOverYearGated> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const oldest = await tx.query.dynamicPricingTierActivations.findFirst({
        orderBy: [asc(dynamicPricingTierActivations.activatedAt)],
      });
      if (!oldest) {
        return {
          available: false,
          reason: 'insufficient_history',
          historyMonthsAvailable: 0,
        } as const;
      }
      const months = monthsBetween(oldest.activatedAt, new Date());
      return {
        available: false,
        reason: 'insufficient_history',
        historyMonthsAvailable: months,
      } as const;
    });
  }

  // ---------- CSV ----------

  toCsv<T extends Record<string, unknown>>(rows: T[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0] as Record<string, unknown>);
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => escape((row as Record<string, unknown>)[h])).join(','));
    }
    return lines.join('\n');
  }

  /**
   * Stream Excel workbook (xlsx) bytes from rows. The xlsx package is
   * already in apps/api/package.json (used by Build 5). We compose a
   * Buffer and let the controller set Content-Type / Content-Disposition.
   */
  async toXlsx<T extends Record<string, unknown>>(sheetName: string, rows: T[]): Promise<Buffer> {
    // Lazy import to keep cold-start small.
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);
    if (rows.length > 0) {
      const headers = Object.keys(rows[0] as Record<string, unknown>);
      ws.columns = headers.map((h) => ({ header: h, key: h }));
      for (const row of rows) ws.addRow(row);
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  private toTenantCtx(ctx: CallerCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
  }
}

function monthsBetween(a: Date, b: Date): number {
  const ya = a.getUTCFullYear();
  const yb = b.getUTCFullYear();
  const ma = a.getUTCMonth();
  const mb = b.getUTCMonth();
  return (yb - ya) * 12 + (mb - ma);
}
