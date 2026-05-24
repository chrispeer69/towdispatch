/**
 * Unit coverage for PnlService (Session 53). Drives the service with a fake
 * TenantAwareDb whose tx returns canned revenue + cost rows, so the merge,
 * margin math, totals, and the revenue-only path (no commission) are tested
 * without a database.
 */
import { describe, expect, it } from 'vitest';
import type { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { AuthCtx } from '../reporting.types.js';
import { PnlService } from './pnl.service.js';

const CTX: AuthCtx = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  requestId: 'req-1',
  ipAddress: null,
  userAgent: null,
  role: 'owner',
};

function serviceWith(...batches: Array<Array<Record<string, unknown>>>): PnlService {
  let i = 0;
  const tx = {
    execute: async <T = Record<string, unknown>>() => ({ rows: (batches[i++] ?? []) as T[] }),
  };
  const db = {
    runInTenantContext: async <T>(_c: unknown, cb: (tx: unknown) => Promise<T>) => cb(tx),
  } as unknown as TenantAwareDb;
  return new PnlService(db);
}

const FROM = new Date('2026-05-01T00:00:00Z');
const TO = new Date('2026-05-31T23:59:59Z');

describe('PnlService.pnl', () => {
  it('merges invoice revenue with job COGS and computes margin + totals', async () => {
    const svc = serviceWith(
      [
        {
          account_id: 'a1',
          name: 'Acme',
          is_motor_club: false,
          revenue_cents: 10000,
          invoice_count: 2,
        },
        {
          account_id: 'a2',
          name: 'Globex',
          is_motor_club: true,
          revenue_cents: 5000,
          invoice_count: 1,
        },
      ],
      [
        { account_id: 'a1', commission_cents: 1000, motor_club_fee_cents: 0, job_count: 3 },
        { account_id: 'a2', commission_cents: 500, motor_club_fee_cents: 750, job_count: 1 },
      ],
    );
    const res = await svc.pnl(CTX, 'accounts', FROM, TO);

    expect(res.rows.map((r) => r.label)).toEqual(['Acme', 'Globex']); // revenue desc
    const [acme, globex] = res.rows;
    expect(acme?.revenueCents).toBe(10000);
    expect(acme?.commissionCents).toBe(1000);
    expect(acme?.marginCents).toBe(9000);
    expect(acme?.otherCogsCents).toBe(0);

    expect(globex?.motorClubFeeCents).toBe(750);
    expect(globex?.marginCents).toBe(5000 - 500 - 750);

    expect(res.totals.revenueCents).toBe(15000);
    expect(res.totals.marginCents).toBe(9000 + 3750);
    expect(res.notes.join(' ')).toMatch(/Fuel, tolls/i);
  });

  it('revenue-only path: no cost rows → margin equals revenue', async () => {
    const svc = serviceWith(
      [
        {
          account_id: 'a1',
          name: 'Acme',
          is_motor_club: false,
          revenue_cents: 8000,
          invoice_count: 1,
        },
      ],
      [],
    );
    const res = await svc.pnl(CTX, 'accounts', FROM, TO);
    expect(res.rows[0]?.commissionCents).toBe(0);
    expect(res.rows[0]?.marginCents).toBe(8000);
    expect(res.totals.marginCents).toBe(8000);
  });

  it('returns empty rows and zero totals for a tenant with no invoices', async () => {
    const svc = serviceWith([], []);
    const res = await svc.pnl(CTX, 'motor-clubs', FROM, TO);
    expect(res.rows).toEqual([]);
    expect(res.totals.revenueCents).toBe(0);
    expect(res.dimension).toBe('motor-clubs');
  });
});
