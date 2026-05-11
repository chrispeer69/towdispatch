/**
 * Compliance report.
 *
 * Surfaces five buckets in priority order:
 *   - HOS exposure: drivers with > 12 hours on shift today (warn at 12, crit
 *     at 14). Aggregated from open driver_shifts.
 *   - Expiring credentials: CDL, license, medical card with expiry inside
 *     30 days.
 *   - Missing COI: accounts requiring a COI but COI expired / absent.
 *   - Hold-vehicle aging: vehicles in yard via recurring_billing_schedules
 *     where started_at > 30 days ago.
 *
 * Each row carries a `daysToBreach` field — negative when already overdue.
 */
import { Injectable } from '@nestjs/common';
import type {
  CommonReportFilters,
  ComplianceRow,
  ReportPage,
  ReportSummary,
} from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { decodeOffset, encodeOffset } from '../cursor.js';
import { ReportingReadService, type ReportContext } from '../reporting-read.service.js';

const HOS_WARN_HOURS = 12;
const HOS_CRIT_HOURS = 14;
const EXPIRY_WINDOW_DAYS = 30;

interface HosRow {
  driver_id: string;
  driver_name: string;
  hours_on_shift: string | number;
}
interface CredentialRow {
  driver_id: string;
  driver_name: string;
  category: 'cdl' | 'license' | 'medical';
  expires_at: string | null;
}
interface CoiRow {
  account_id: string;
  account_name: string;
  coi_expires_at: string | null;
}
interface HoldRow {
  schedule_id: string;
  vehicle_label: string;
  started_at: string;
}

@Injectable()
export class ComplianceReportService {
  constructor(private readonly read: ReportingReadService) {}

  async summary(ctx: ReportContext, _filters: CommonReportFilters): Promise<ReportSummary> {
    const rows = await this.list(ctx, _filters);
    const counts = rows.rows.reduce(
      (a, r) => {
        a.total += 1;
        if (r.severity === 'critical') a.crit += 1;
        else if (r.severity === 'warn') a.warn += 1;
        return a;
      },
      { total: 0, crit: 0, warn: 0 },
    );
    return {
      reportId: 'compliance',
      generatedAt: new Date().toISOString(),
      windowFrom: new Date().toISOString(),
      windowTo: new Date().toISOString(),
      kpis: [
        { label: 'Open items', value: counts.total.toLocaleString() },
        {
          label: 'Critical',
          value: counts.crit.toLocaleString(),
          trend: counts.crit > 0 ? 'bad' : 'good',
        },
        {
          label: 'Warnings',
          value: counts.warn.toLocaleString(),
          trend: counts.warn > 0 ? 'bad' : 'neutral',
        },
      ],
    };
  }

  async list(
    ctx: ReportContext,
    filters: CommonReportFilters,
  ): Promise<ReportPage<ComplianceRow>> {
    const [hos, creds, coi, holds] = await Promise.all([
      this.queryHos(ctx),
      this.queryCredentials(ctx),
      this.queryCoi(ctx),
      this.queryHolds(ctx),
    ]);
    const out: ComplianceRow[] = [];
    for (const r of hos) {
      const h = Number(r.hours_on_shift);
      const severity: ComplianceRow['severity'] = h >= HOS_CRIT_HOURS ? 'critical' : 'warn';
      out.push({
        category: 'hos',
        refId: r.driver_id,
        subject: r.driver_name,
        detail: `${h.toFixed(1)} hours on duty (HOS limit 14 hrs)`,
        daysToBreach: severity === 'critical' ? -(h - HOS_CRIT_HOURS) : HOS_CRIT_HOURS - h,
        severity,
      });
    }
    for (const r of creds) {
      const daysLeft = r.expires_at
        ? Math.floor((new Date(r.expires_at).getTime() - Date.now()) / 86_400_000)
        : null;
      out.push({
        category: r.category,
        refId: r.driver_id,
        subject: r.driver_name,
        detail: `${r.category.toUpperCase()} expires ${r.expires_at ?? 'unknown'}`,
        daysToBreach: daysLeft,
        severity: daysLeft != null && daysLeft < 0 ? 'critical' : daysLeft != null && daysLeft < 7 ? 'critical' : 'warn',
      });
    }
    for (const r of coi) {
      const daysLeft = r.coi_expires_at
        ? Math.floor((new Date(r.coi_expires_at).getTime() - Date.now()) / 86_400_000)
        : null;
      out.push({
        category: 'coi',
        refId: r.account_id,
        subject: r.account_name,
        detail: r.coi_expires_at == null ? 'COI required, none on file' : `COI expires ${r.coi_expires_at}`,
        daysToBreach: daysLeft,
        severity: daysLeft != null && daysLeft < 0 ? 'critical' : daysLeft == null ? 'critical' : 'warn',
      });
    }
    for (const r of holds) {
      const days = Math.floor((Date.now() - new Date(r.started_at).getTime()) / 86_400_000);
      out.push({
        category: 'hold_vehicle',
        refId: r.schedule_id,
        subject: r.vehicle_label,
        detail: `${days} days in yard`,
        daysToBreach: -days,
        severity: days >= 60 ? 'critical' : days >= 30 ? 'warn' : 'info',
      });
    }
    // sort: critical first, then by absolute days-to-breach ascending
    out.sort((a, b) => {
      const sevWeight: Record<ComplianceRow['severity'], number> = {
        critical: 0,
        warn: 1,
        info: 2,
      };
      if (sevWeight[a.severity] !== sevWeight[b.severity])
        return sevWeight[a.severity] - sevWeight[b.severity];
      return (a.daysToBreach ?? 9999) - (b.daysToBreach ?? 9999);
    });
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = decodeOffset(filters.cursor);
    return {
      rows: out.slice(offset, offset + limit),
      nextCursor: offset + limit < out.length ? encodeOffset(offset + limit) : null,
      total: out.length,
    };
  }

  private async queryHos(ctx: ReportContext): Promise<HosRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<HosRow>(sql`
        SELECT
          d.id::text AS driver_id,
          COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), 'Driver') AS driver_name,
          EXTRACT(EPOCH FROM (now() - s.started_at)) / 3600.0 AS hours_on_shift
        FROM driver_shifts s
        JOIN drivers d ON d.id = s.driver_id
        WHERE s.ended_at IS NULL
          AND s.deleted_at IS NULL
          AND d.deleted_at IS NULL
          AND EXTRACT(EPOCH FROM (now() - s.started_at)) / 3600.0 >= ${HOS_WARN_HOURS}
      `);
      return result.rows;
    });
  }

  private async queryCredentials(ctx: ReportContext): Promise<CredentialRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<CredentialRow>(sql`
        SELECT * FROM (
          SELECT
            d.id::text AS driver_id,
            COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), 'Driver') AS driver_name,
            'cdl' AS category,
            d.cdl_expires_at::text AS expires_at
          FROM drivers d
          WHERE d.deleted_at IS NULL
            AND d.cdl_expires_at IS NOT NULL
            AND d.cdl_expires_at <= now() + interval '${sql.raw(String(EXPIRY_WINDOW_DAYS))} days'
          UNION ALL
          SELECT
            d.id::text,
            COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), 'Driver'),
            'license',
            d.license_expires_at::text
          FROM drivers d
          WHERE d.deleted_at IS NULL
            AND d.license_expires_at IS NOT NULL
            AND d.license_expires_at <= now() + interval '${sql.raw(String(EXPIRY_WINDOW_DAYS))} days'
          UNION ALL
          SELECT
            d.id::text,
            COALESCE(NULLIF(TRIM(CONCAT(d.first_name, ' ', d.last_name)), ''), 'Driver'),
            'medical',
            d.medical_card_expires_at::text
          FROM drivers d
          WHERE d.deleted_at IS NULL
            AND d.medical_card_expires_at IS NOT NULL
            AND d.medical_card_expires_at <= now() + interval '${sql.raw(String(EXPIRY_WINDOW_DAYS))} days'
        ) creds
        ORDER BY expires_at ASC NULLS LAST
      `);
      return result.rows;
    });
  }

  private async queryCoi(ctx: ReportContext): Promise<CoiRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<CoiRow>(sql`
        SELECT
          a.id::text AS account_id,
          a.name AS account_name,
          a.coi_expires_at::text AS coi_expires_at
        FROM accounts a
        WHERE a.deleted_at IS NULL
          AND a.coi_required = true
          AND (a.coi_expires_at IS NULL OR a.coi_expires_at <= now() + interval '${sql.raw(String(EXPIRY_WINDOW_DAYS))} days')
      `);
      return result.rows;
    });
  }

  private async queryHolds(ctx: ReportContext): Promise<HoldRow[]> {
    return this.read.run(ctx, async (db) => {
      const result = await db.execute<HoldRow>(sql`
        SELECT
          s.id::text AS schedule_id,
          COALESCE(
            NULLIF(TRIM(CONCAT(v.year, ' ', v.make, ' ', v.model)), ''),
            v.vin, v.plate, 'Vehicle'
          ) AS vehicle_label,
          s.started_at::text AS started_at
        FROM recurring_billing_schedules s
        LEFT JOIN jobs j ON j.id = s.job_id
        LEFT JOIN vehicles v ON v.id = j.vehicle_id
        WHERE s.deleted_at IS NULL
          AND s.ended_at IS NULL
          AND s.started_at <= now() - interval '30 days'
        ORDER BY s.started_at ASC
        LIMIT 500
      `);
      return result.rows;
    });
  }
}
