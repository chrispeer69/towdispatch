/**
 * PnlService — per-account and per-motor-club profit & loss (Session 53).
 *
 * Revenue is invoice-based (sum of total_cents issued in the window, excluding
 * void). COGS = driver commission (via drivers.commission_rule_id →
 * commission_rules, mirroring the Session 14 pnl reporter) + a 15% motor-club
 * fee proxy on motor-club accounts. Fuel / tolls / depreciation are $0 — those
 * columns don't exist on master (SESSION_53_DECISIONS D5) — and a note says so.
 *
 * Rows are sorted by revenue desc and capped at 100 + an aggregated "Other"
 * bucket so a tenant with thousands of accounts gets a bounded payload.
 */
import { Injectable } from '@nestjs/common';
import type { PnlResponse, PnlRow } from '@ustowdispatch/shared';
import { sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { AuthCtx } from '../reporting.types.js';

const MOTOR_CLUB_FEE_PCT = 15;
const ROW_CAP = 100;

type RevenueRow = {
  account_id: string | null;
  name: string | null;
  is_motor_club: boolean;
  revenue_cents: number | string;
  invoice_count: number | string;
};
type CostRow = {
  account_id: string | null;
  commission_cents: number | string;
  motor_club_fee_cents: number | string;
  job_count: number | string;
};

@Injectable()
export class PnlService {
  constructor(private readonly db: TenantAwareDb) {}

  async pnl(
    ctx: AuthCtx,
    dimension: 'accounts' | 'motor-clubs',
    from: Date,
    to: Date,
    accountId?: string,
  ): Promise<PnlResponse> {
    const motorClubOnly = dimension === 'motor-clubs';

    const rows = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const revenue = await tx.execute<RevenueRow>(sql`
        SELECT i.account_id,
               a.name,
               coalesce(a.is_motor_club, false) AS is_motor_club,
               coalesce(sum(i.total_cents), 0)::bigint AS revenue_cents,
               count(*)::int AS invoice_count
          FROM invoices i
          JOIN accounts a ON a.id = i.account_id
         WHERE i.tenant_id = ${ctx.tenantId}::uuid
           AND i.deleted_at IS NULL
           AND i.status <> 'void'
           AND coalesce(i.issued_at, i.created_at) >= ${from.toISOString()}::timestamptz
           AND coalesce(i.issued_at, i.created_at) <= ${to.toISOString()}::timestamptz
           ${motorClubOnly ? sql`AND a.is_motor_club = true` : sql``}
           ${accountId ? sql`AND a.id = ${accountId}::uuid` : sql``}
         GROUP BY i.account_id, a.name, a.is_motor_club
      `);

      const costs = await tx.execute<CostRow>(sql`
        WITH scored AS (
          SELECT j.account_id,
                 j.rate_quoted_cents,
                 coalesce(a.is_motor_club, false) AS is_motor_club,
                 cr.rule_type,
                 coalesce(cr.rate_pct, '0')::numeric AS rate_pct,
                 coalesce(cr.flat_cents, 0) AS flat_cents,
                 coalesce(cr.cap_cents, 9223372036854775807) AS cap_cents,
                 coalesce(cr.floor_cents, 0) AS floor_cents
            FROM jobs j
            LEFT JOIN drivers d ON d.id = j.assigned_driver_id
            LEFT JOIN commission_rules cr ON cr.id = d.commission_rule_id AND cr.active
            LEFT JOIN accounts a ON a.id = j.account_id
           WHERE j.tenant_id = ${ctx.tenantId}::uuid
             AND j.deleted_at IS NULL
             AND j.status = 'completed'
             AND j.created_at >= ${from.toISOString()}::timestamptz
             AND j.created_at <= ${to.toISOString()}::timestamptz
             ${motorClubOnly ? sql`AND a.is_motor_club = true` : sql``}
             ${accountId ? sql`AND j.account_id = ${accountId}::uuid` : sql``}
        )
        SELECT account_id,
               coalesce(sum(CASE rule_type
                 WHEN 'flat' THEN flat_cents
                 WHEN 'percent' THEN least(cap_cents, greatest(floor_cents, (rate_quoted_cents * rate_pct / 100)::bigint))
                 ELSE 0 END), 0)::bigint AS commission_cents,
               coalesce(sum(CASE WHEN is_motor_club
                 THEN (rate_quoted_cents * ${MOTOR_CLUB_FEE_PCT} / 100)::bigint ELSE 0 END), 0)::bigint AS motor_club_fee_cents,
               count(*)::int AS job_count
          FROM scored
         GROUP BY account_id
      `);

      const costByAccount = new Map<string, CostRow>();
      for (const c of costs.rows ?? []) {
        if (c.account_id) costByAccount.set(c.account_id, c);
      }

      return (revenue.rows ?? []).map((r): PnlRow => {
        const cost = r.account_id ? costByAccount.get(r.account_id) : undefined;
        const revenueCents = Number(r.revenue_cents);
        const commissionCents = Number(cost?.commission_cents ?? 0);
        const motorClubFeeCents = Number(cost?.motor_club_fee_cents ?? 0);
        const otherCogsCents = 0;
        return {
          key: r.account_id ?? 'unassigned',
          label: r.name ?? '(unassigned)',
          revenueCents,
          commissionCents,
          motorClubFeeCents,
          otherCogsCents,
          marginCents: revenueCents - commissionCents - motorClubFeeCents - otherCogsCents,
          jobCount: Number(cost?.job_count ?? 0),
        };
      });
    });

    rows.sort((a, b) => b.revenueCents - a.revenueCents);
    const capped = capWithOther(rows, ROW_CAP);
    const totals = sumRows(capped);

    return {
      dimension,
      from: from.toISOString(),
      to: to.toISOString(),
      rows: capped,
      totals,
      notes: [
        'Revenue is invoice-based (total of non-void invoices issued in the window).',
        'COGS = driver commission + a 15% motor-club fee proxy. Fuel, tolls, and depreciation are $0 (those columns are not tracked on master).',
      ],
    };
  }
}

function capWithOther(rows: PnlRow[], cap: number): PnlRow[] {
  if (rows.length <= cap) return rows;
  const top = rows.slice(0, cap);
  const rest = rows.slice(cap);
  const other = sumRows(rest);
  other.key = '__other__';
  other.label = `Other (${rest.length})`;
  return [...top, other];
}

function sumRows(rows: PnlRow[]): PnlRow {
  return rows.reduce<PnlRow>(
    (acc, r) => ({
      key: acc.key,
      label: acc.label,
      revenueCents: acc.revenueCents + r.revenueCents,
      commissionCents: acc.commissionCents + r.commissionCents,
      motorClubFeeCents: acc.motorClubFeeCents + r.motorClubFeeCents,
      otherCogsCents: acc.otherCogsCents + r.otherCogsCents,
      marginCents: acc.marginCents + r.marginCents,
      jobCount: acc.jobCount + r.jobCount,
    }),
    {
      key: '__total__',
      label: 'Total',
      revenueCents: 0,
      commissionCents: 0,
      motorClubFeeCents: 0,
      otherCogsCents: 0,
      marginCents: 0,
      jobCount: 0,
    },
  );
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
