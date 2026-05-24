/**
 * KPI widget compute functions (Session 53).
 *
 * One pure compute function per widget id, collected in WIDGET_COMPUTE so the
 * service can resolve `widgetId -> fn`. Each fn takes a minimal `KpiTx`
 * (anything with `.execute`) + tenantId + widget config and returns a computed
 * value; it never touches NestJS, so each is unit-testable against a fake tx.
 *
 * Conventions:
 *   - money values are returned in integer CENTS with unit '$' (the web tile
 *     divides by 100); rates are 0..100 numbers with unit '%'; durations are
 *     minutes with unit 'min'; plain counts have unit null.
 *   - a widget whose source data isn't cleanly available returns value:null +
 *     a note rather than throwing (see SESSION_53_DECISIONS D9).
 */
import type { KpiWidgetId } from '@ustowdispatch/shared';
import { type SQL, sql } from 'drizzle-orm';

export interface KpiTx {
  execute<T = Record<string, unknown>>(query: SQL): Promise<{ rows: T[] }>;
}

export interface KpiComputed {
  value: number | string | null;
  unit: string | null;
  deltaPct: number | null;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  series: Array<{ label: string; value: number }> | null;
  note: string | null;
}

export type KpiComputeFn = (
  tx: KpiTx,
  tenantId: string,
  config: Record<string, unknown>,
) => Promise<KpiComputed>;

const base = (over: Partial<KpiComputed> = {}): KpiComputed => ({
  value: 0,
  unit: null,
  deltaPct: null,
  tone: 'neutral',
  series: null,
  note: null,
  ...over,
});

async function scalar(tx: KpiTx, query: SQL): Promise<number> {
  const r = await tx.execute<{ n: number | string | null }>(query);
  return Number(r.rows[0]?.n ?? 0);
}

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

const jobsToday: KpiComputeFn = async (tx, tenantId) => {
  const n = await scalar(
    tx,
    sql`SELECT count(*)::int AS n FROM jobs
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          AND created_at >= date_trunc('day', now())`,
  );
  return base({ value: n });
};

const revenueWindow = async (
  tx: KpiTx,
  tenantId: string,
  windowStart: SQL,
  priorStart: SQL | null,
  priorEnd: SQL | null,
): Promise<KpiComputed> => {
  const current = await scalar(
    tx,
    sql`SELECT coalesce(sum(total_cents), 0)::bigint AS n FROM invoices
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status <> 'void'
          AND coalesce(issued_at, created_at) >= ${windowStart}`,
  );
  let deltaPct: number | null = null;
  if (priorStart && priorEnd) {
    const prior = await scalar(
      tx,
      sql`SELECT coalesce(sum(total_cents), 0)::bigint AS n FROM invoices
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status <> 'void'
            AND coalesce(issued_at, created_at) >= ${priorStart}
            AND coalesce(issued_at, created_at) < ${priorEnd}`,
    );
    deltaPct = pctDelta(current, prior);
  }
  return base({ value: current, unit: '$', deltaPct, tone: 'neutral' });
};

const revenueMtd: KpiComputeFn = async (tx, tenantId, config) => {
  const compare = config.compare_to === 'last_month';
  return revenueWindow(
    tx,
    tenantId,
    sql`date_trunc('month', now())`,
    compare ? sql`date_trunc('month', now()) - interval '1 month'` : null,
    compare ? sql`date_trunc('month', now())` : null,
  );
};

const revenueYtd: KpiComputeFn = async (tx, tenantId, config) => {
  const compare = config.compare_to === 'last_year';
  return revenueWindow(
    tx,
    tenantId,
    sql`date_trunc('year', now())`,
    compare ? sql`date_trunc('year', now()) - interval '1 year'` : null,
    compare ? sql`date_trunc('year', now())` : null,
  );
};

const goaRate7d: KpiComputeFn = async (tx, tenantId) => {
  const r = await tx.execute<{ goa: number | string; total: number | string }>(
    sql`SELECT
          count(*) FILTER (WHERE status = 'goa')::int AS goa,
          count(*) FILTER (WHERE status <> 'cancelled')::int AS total
        FROM jobs
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          AND created_at >= now() - interval '7 days'`,
  );
  const goa = Number(r.rows[0]?.goa ?? 0);
  const total = Number(r.rows[0]?.total ?? 0);
  const rate = total === 0 ? 0 : Math.round((goa / total) * 1000) / 10;
  return base({ value: rate, unit: '%', tone: rate >= 15 ? 'warn' : 'ok' });
};

const avgEta7d: KpiComputeFn = async () =>
  // Job rows carry only assigned_at — there is no on-scene timestamp column,
  // and job_status_history status names aren't a stable contract. Ships as a
  // null tile until ETA instrumentation lands (SESSION_53_DECISIONS D9).
  base({
    value: null,
    unit: 'min',
    note: 'ETA timing not available from the jobs table yet.',
  });

const openImpoundCount: KpiComputeFn = async (tx, tenantId) => {
  const n = await scalar(
    tx,
    sql`SELECT count(*)::int AS n FROM impound_records
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND released_at IS NULL`,
  );
  return base({ value: n });
};

const lienDue30d: KpiComputeFn = async (tx, tenantId) => {
  const n = await scalar(
    tx,
    sql`SELECT count(*)::int AS n FROM lien_cases
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          AND status IN ('open', 'ready_for_sale')
          AND next_action_due_at IS NOT NULL
          AND next_action_due_at <= now() + interval '30 days'`,
  );
  return base({ value: n, tone: n > 0 ? 'warn' : 'ok' });
};

const accountsAgingTotal: KpiComputeFn = async (tx, tenantId) => {
  const n = await scalar(
    tx,
    sql`SELECT coalesce(sum(balance_cents), 0)::bigint AS n FROM invoices
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          AND status <> 'void' AND balance_cents > 0`,
  );
  return base({ value: n, unit: '$' });
};

const topAccountsRevenue = (motorClubOnly: boolean): KpiComputeFn => {
  return async (tx, tenantId) => {
    const r = await tx.execute<{ label: string | null; cents: number | string }>(
      sql`SELECT a.name AS label, coalesce(sum(i.total_cents), 0)::bigint AS cents
          FROM invoices i
          JOIN accounts a ON a.id = i.account_id
          WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL
            AND i.status <> 'void'
            AND coalesce(i.issued_at, i.created_at) >= date_trunc('month', now())
            AND a.is_motor_club = ${motorClubOnly}
          GROUP BY a.name
          ORDER BY cents DESC
          LIMIT 5`,
    );
    const series = (r.rows ?? []).map((row) => ({
      label: row.label ?? '(unnamed)',
      value: Number(row.cents),
    }));
    return base({ value: null, unit: '$', series });
  };
};

const driverCountActive: KpiComputeFn = async (tx, tenantId) => {
  const n = await scalar(
    tx,
    sql`SELECT count(*)::int AS n FROM drivers
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND active = true`,
  );
  return base({ value: n });
};

const truckCountActive: KpiComputeFn = async (tx, tenantId) => {
  const n = await scalar(
    tx,
    sql`SELECT count(*)::int AS n FROM trucks
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND in_service = true`,
  );
  return base({ value: n });
};

export const WIDGET_COMPUTE: Record<KpiWidgetId, KpiComputeFn> = {
  jobs_today: jobsToday,
  revenue_mtd: revenueMtd,
  revenue_ytd: revenueYtd,
  goa_rate_7d: goaRate7d,
  avg_eta_7d: avgEta7d,
  open_impound_count: openImpoundCount,
  lien_due_30d: lienDue30d,
  accounts_aging_total: accountsAgingTotal,
  top_5_accounts_revenue_mtd: topAccountsRevenue(false),
  top_5_motor_clubs_revenue_mtd: topAccountsRevenue(true),
  driver_count_active: driverCountActive,
  truck_count_active: truckCountActive,
};

export const WIDGET_LABELS: Record<KpiWidgetId, string> = {
  jobs_today: 'Jobs Today',
  revenue_mtd: 'Revenue MTD',
  revenue_ytd: 'Revenue YTD',
  goa_rate_7d: 'GOA Rate (7d)',
  avg_eta_7d: 'Avg ETA (7d)',
  open_impound_count: 'Open Impounds',
  lien_due_30d: 'Liens Due (30d)',
  accounts_aging_total: 'A/R Aging Total',
  top_5_accounts_revenue_mtd: 'Top 5 Accounts (MTD)',
  top_5_motor_clubs_revenue_mtd: 'Top 5 Motor Clubs (MTD)',
  driver_count_active: 'Active Drivers',
  truck_count_active: 'Active Trucks',
};
