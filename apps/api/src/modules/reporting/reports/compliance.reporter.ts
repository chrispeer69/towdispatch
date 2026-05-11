/**
 * Compliance reporter.
 *
 *   - HOS exposure: drivers whose active shift is approaching the 14-hr duty
 *     window (driver_shifts.started_at older than now() - 12 hours, with
 *     ended_at null). We can't see actual driving time without ELD logs, so
 *     v1 uses shift-start as a proxy and documents it.
 *   - Expired credentials: drivers with cdl_expires_at, license_expires_at,
 *     medical_card_expires_at, or any cert in the past or within 30 days.
 *   - Missing COIs: accounts with coi_required=true and (coi_document_url null
 *     OR coi_expires_at past now()).
 *   - Hold-vehicle aging: active recurring_billing_schedules over 60 days.
 */
import { Injectable } from '@nestjs/common';
import type { ReportId } from '@towcommand/shared';
import { sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type {
  AuthCtx,
  ReportDetail,
  ReportFilters,
  ReportSummary,
  Reporter,
} from '../reporting.types.js';

@Injectable()
export class ComplianceReporter implements Reporter {
  readonly id: ReportId = 'compliance';

  constructor(private readonly db: TenantAwareDb) {}

  async summary(ctx: AuthCtx, _filters: ReportFilters): Promise<ReportSummary> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const r = await tx.execute<{
        hos_at_risk: number;
        creds_expiring: number;
        coi_missing: number;
        hold_over_60: number;
      }>(sql`
        SELECT
          (SELECT count(*)::int FROM driver_shifts s
             WHERE s.tenant_id = ${ctx.tenantId}::uuid
               AND s.deleted_at IS NULL
               AND s.ended_at IS NULL
               AND s.started_at <= now() - interval '12 hours') AS hos_at_risk,
          (SELECT count(*)::int FROM drivers d
             WHERE d.tenant_id = ${ctx.tenantId}::uuid
               AND d.deleted_at IS NULL
               AND d.active = true
               AND (
                 (d.cdl_expires_at IS NOT NULL AND d.cdl_expires_at <= (current_date + interval '30 days')::date)
                 OR (d.license_expires_at IS NOT NULL AND d.license_expires_at <= (current_date + interval '30 days')::date)
                 OR (d.medical_card_expires_at IS NOT NULL AND d.medical_card_expires_at <= (current_date + interval '30 days')::date)
               )) AS creds_expiring,
          (SELECT count(*)::int FROM accounts a
             WHERE a.tenant_id = ${ctx.tenantId}::uuid
               AND a.deleted_at IS NULL
               AND a.coi_required = true
               AND (a.coi_document_url IS NULL OR a.coi_expires_at < current_date)) AS coi_missing,
          (SELECT count(*)::int FROM recurring_billing_schedules s
             WHERE s.tenant_id = ${ctx.tenantId}::uuid
               AND s.deleted_at IS NULL
               AND s.ended_at IS NULL
               AND s.started_at <= now() - interval '60 days') AS hold_over_60
      `);
      const row = r.rows[0] ?? {
        hos_at_risk: 0,
        creds_expiring: 0,
        coi_missing: 0,
        hold_over_60: 0,
      };
      return {
        reportId: this.id,
        headline: 'Compliance',
        asOf: new Date(),
        kpis: [
          {
            label: 'HOS exposure',
            value: Number(row.hos_at_risk),
            tone: Number(row.hos_at_risk) > 0 ? 'danger' : 'ok',
          },
          {
            label: 'Credentials expiring',
            value: Number(row.creds_expiring),
            tone: Number(row.creds_expiring) > 0 ? 'warn' : 'ok',
          },
          {
            label: 'Missing COIs',
            value: Number(row.coi_missing),
            tone: Number(row.coi_missing) > 0 ? 'danger' : 'ok',
          },
          {
            label: 'Holds > 60 days',
            value: Number(row.hold_over_60),
            tone: Number(row.hold_over_60) > 0 ? 'warn' : 'ok',
          },
        ],
      };
    });
  }

  async detail(ctx: AuthCtx, filters: ReportFilters): Promise<ReportDetail> {
    const summary = await this.summary(ctx, filters);
    const limit = filters.limit ?? 100;
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      // Combined exception list — every actionable row, typed by `kind`.
      const rowsRes = await tx.execute<{
        kind: string;
        subject_id: string;
        subject: string;
        detail: string;
        severity: string;
        days: number | null;
      }>(sql`
        WITH hos AS (
          SELECT 'hos'::text AS kind,
                 s.id::text AS subject_id,
                 (coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''))::text AS subject,
                 'On-shift over 12 hours' AS detail,
                 'danger'::text AS severity,
                 (extract(epoch from (now() - s.started_at)) / 3600)::int AS days
            FROM driver_shifts s
            JOIN drivers d ON d.id = s.driver_id
           WHERE s.tenant_id = ${ctx.tenantId}::uuid
             AND s.deleted_at IS NULL
             AND s.ended_at IS NULL
             AND s.started_at <= now() - interval '12 hours'
        ),
        creds AS (
          SELECT 'credential'::text AS kind,
                 d.id::text AS subject_id,
                 (coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''))::text AS subject,
                 CASE
                   WHEN d.cdl_expires_at <= current_date THEN 'CDL expired'
                   WHEN d.cdl_expires_at <= current_date + interval '30 days' THEN 'CDL expires soon'
                   WHEN d.license_expires_at <= current_date THEN 'License expired'
                   WHEN d.license_expires_at <= current_date + interval '30 days' THEN 'License expires soon'
                   WHEN d.medical_card_expires_at <= current_date THEN 'Medical card expired'
                   ELSE 'Medical card expires soon'
                 END AS detail,
                 CASE
                   WHEN d.cdl_expires_at <= current_date OR d.license_expires_at <= current_date
                        OR d.medical_card_expires_at <= current_date THEN 'danger' ELSE 'warn' END AS severity,
                 NULL::int AS days
            FROM drivers d
           WHERE d.tenant_id = ${ctx.tenantId}::uuid
             AND d.deleted_at IS NULL
             AND d.active = true
             AND (
               (d.cdl_expires_at IS NOT NULL AND d.cdl_expires_at <= (current_date + interval '30 days')::date)
               OR (d.license_expires_at IS NOT NULL AND d.license_expires_at <= (current_date + interval '30 days')::date)
               OR (d.medical_card_expires_at IS NOT NULL AND d.medical_card_expires_at <= (current_date + interval '30 days')::date)
             )
        ),
        coi AS (
          SELECT 'coi'::text AS kind,
                 a.id::text AS subject_id,
                 a.name AS subject,
                 CASE
                   WHEN a.coi_document_url IS NULL THEN 'No COI on file'
                   WHEN a.coi_expires_at < current_date THEN 'COI expired'
                   ELSE 'COI missing'
                 END AS detail,
                 'danger'::text AS severity,
                 NULL::int AS days
            FROM accounts a
           WHERE a.tenant_id = ${ctx.tenantId}::uuid
             AND a.deleted_at IS NULL
             AND a.coi_required = true
             AND (a.coi_document_url IS NULL OR a.coi_expires_at < current_date)
        ),
        holds AS (
          SELECT 'hold'::text AS kind,
                 s.id::text AS subject_id,
                 s.description AS subject,
                 ('In yard ' || ((extract(epoch from (now() - s.started_at))/86400)::int)::text || ' days') AS detail,
                 CASE WHEN (extract(epoch from (now() - s.started_at))/86400) > 90 THEN 'danger' ELSE 'warn' END AS severity,
                 (extract(epoch from (now() - s.started_at))/86400)::int AS days
            FROM recurring_billing_schedules s
           WHERE s.tenant_id = ${ctx.tenantId}::uuid
             AND s.deleted_at IS NULL
             AND s.ended_at IS NULL
             AND s.started_at <= now() - interval '60 days'
        )
        SELECT * FROM hos
        UNION ALL SELECT * FROM creds
        UNION ALL SELECT * FROM coi
        UNION ALL SELECT * FROM holds
        ORDER BY severity DESC, kind ASC
        LIMIT ${limit}
      `);

      const rows = (rowsRes.rows ?? []).map((r) => ({
        kind: r.kind,
        subjectId: r.subject_id,
        subject: (r.subject ?? '').trim() || '(unknown)',
        detail: r.detail,
        severity: r.severity,
        days: r.days === null ? null : Number(r.days),
      }));

      // Breakdown — count by kind.
      const kindCounts = new Map<string, number>();
      for (const row of rows) kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);
      const breakdown = Array.from(kindCounts.entries()).map(([k, v]) => ({
        key: k,
        label: kindLabel(k),
        value: v,
      }));

      return {
        reportId: this.id,
        generatedAt: new Date(),
        kpis: summary.kpis,
        timeSeries: [],
        breakdown,
        rows,
        totalRows: rows.length,
        nextCursor: null,
        notes: [
          'HOS exposure uses shift-start as a proxy for hours-on-duty until ELD ingestion ships.',
          'Credentials list surfaces anything within 30 days of expiry — sort by severity to triage.',
        ],
      };
    });
  }
}

function kindLabel(k: string): string {
  switch (k) {
    case 'hos':
      return 'HOS exposure';
    case 'credential':
      return 'Credentials';
    case 'coi':
      return 'COI gaps';
    case 'hold':
      return 'Aged holds';
    default:
      return k;
  }
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
