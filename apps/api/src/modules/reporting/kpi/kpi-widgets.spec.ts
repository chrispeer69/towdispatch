/**
 * Unit coverage for the KPI widget compute functions (Session 53). Each fn is
 * pure over a fake KpiTx, so we drive it with canned rows — boundary,
 * empty-tenant, and one-row cases — without a database.
 */
import { describe, expect, it } from 'vitest';
import { type KpiTx, WIDGET_COMPUTE } from './kpi-widgets.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

/** Returns each batch of rows in FIFO order on successive execute() calls. */
function fakeTx(...batches: Array<Array<Record<string, unknown>>>): KpiTx {
  let i = 0;
  return {
    execute: async <T = Record<string, unknown>>() => ({
      rows: (batches[i++] ?? []) as T[],
    }),
  };
}

describe('jobs_today', () => {
  it('returns the scalar count', async () => {
    const r = await WIDGET_COMPUTE.jobs_today(fakeTx([{ n: 7 }]), TENANT, {});
    expect(r.value).toBe(7);
    expect(r.unit).toBeNull();
  });

  it('returns 0 for an empty tenant', async () => {
    const r = await WIDGET_COMPUTE.jobs_today(fakeTx([]), TENANT, {});
    expect(r.value).toBe(0);
  });
});

describe('goa_rate_7d', () => {
  it('computes a percentage and warns past the threshold', async () => {
    const r = await WIDGET_COMPUTE.goa_rate_7d(fakeTx([{ goa: 3, total: 12 }]), TENANT, {});
    expect(r.value).toBe(25);
    expect(r.unit).toBe('%');
    expect(r.tone).toBe('warn');
  });

  it('is 0% with no jobs (no divide-by-zero)', async () => {
    const r = await WIDGET_COMPUTE.goa_rate_7d(fakeTx([{ goa: 0, total: 0 }]), TENANT, {});
    expect(r.value).toBe(0);
    expect(r.tone).toBe('ok');
  });
});

describe('revenue_mtd', () => {
  it('returns cents with $ unit and no delta by default', async () => {
    const r = await WIDGET_COMPUTE.revenue_mtd(fakeTx([{ n: 123_45 }]), TENANT, {});
    expect(r.value).toBe(12345);
    expect(r.unit).toBe('$');
    expect(r.deltaPct).toBeNull();
  });

  it('computes a +delta vs last month when compare_to is set', async () => {
    const r = await WIDGET_COMPUTE.revenue_mtd(fakeTx([{ n: 200 }], [{ n: 100 }]), TENANT, {
      compare_to: 'last_month',
    });
    expect(r.value).toBe(200);
    expect(r.deltaPct).toBe(100);
  });
});

describe('top_5_accounts_revenue_mtd', () => {
  it('returns an ordered series', async () => {
    const r = await WIDGET_COMPUTE.top_5_accounts_revenue_mtd(
      fakeTx([
        { label: 'Acme', cents: 5000 },
        { label: 'Globex', cents: 3000 },
      ]),
      TENANT,
      {},
    );
    expect(r.series).toEqual([
      { label: 'Acme', value: 5000 },
      { label: 'Globex', value: 3000 },
    ]);
    expect(r.unit).toBe('$');
  });
});

describe('lien_due_30d', () => {
  it('warns when any lien is due', async () => {
    const r = await WIDGET_COMPUTE.lien_due_30d(fakeTx([{ n: 2 }]), TENANT, {});
    expect(r.value).toBe(2);
    expect(r.tone).toBe('warn');
  });
});

describe('avg_eta_7d', () => {
  it('degrades to a null tile with a note (no source data)', async () => {
    const r = await WIDGET_COMPUTE.avg_eta_7d(fakeTx(), TENANT, {});
    expect(r.value).toBeNull();
    expect(r.note).toMatch(/not available/i);
  });
});
