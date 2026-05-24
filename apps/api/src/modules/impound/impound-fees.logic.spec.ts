import { describe, expect, it } from 'vitest';
import {
  ACCRUING_STATUSES,
  LIEN_ELIGIBLE_AFTER_DAYS,
  MAX_BACKFILL_DAYS,
  addUtcDays,
  computeLienEligibility,
  diffUtcDays,
  planDailyAccrual,
  sumFeeCents,
  toUtcDateString,
} from './impound-fees.logic.js';

const D = (s: string): Date => new Date(`${s}T12:00:00.000Z`);

describe('date helpers', () => {
  it('toUtcDateString slices the UTC calendar day', () => {
    expect(toUtcDateString(new Date('2026-05-23T23:30:00.000Z'))).toBe('2026-05-23');
  });

  it('addUtcDays crosses month + year boundaries', () => {
    expect(addUtcDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addUtcDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addUtcDays('2026-03-10', -10)).toBe('2026-02-28');
  });

  it('diffUtcDays returns signed whole-day differences', () => {
    expect(diffUtcDays('2026-05-01', '2026-05-04')).toBe(3);
    expect(diffUtcDays('2026-05-04', '2026-05-01')).toBe(-3);
    expect(diffUtcDays('2026-05-01', '2026-05-01')).toBe(0);
  });
});

describe('planDailyAccrual', () => {
  it('bills the arrival day on first accrual (never accrued before)', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-05-20'),
        lastAccruedOn: null,
        dailyFeeCents: 3500,
        status: 'stored',
      },
      D('2026-05-20'),
    );
    expect(plan.daysToAccrue).toEqual(['2026-05-20']);
    expect(plan.totalCents).toBe(3500);
    expect(plan.newLastAccruedOn).toBe('2026-05-20');
  });

  it('catches up every missed calendar day in one tick', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-05-20'),
        lastAccruedOn: null,
        dailyFeeCents: 1000,
        status: 'stored',
      },
      D('2026-05-23'),
    );
    expect(plan.daysToAccrue).toEqual(['2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23']);
    expect(plan.totalCents).toBe(4000);
    expect(plan.newLastAccruedOn).toBe('2026-05-23');
  });

  it('resumes the day after last_accrued_on', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-05-20'),
        lastAccruedOn: '2026-05-22',
        dailyFeeCents: 1000,
        status: 'stored',
      },
      D('2026-05-24'),
    );
    expect(plan.daysToAccrue).toEqual(['2026-05-23', '2026-05-24']);
    expect(plan.totalCents).toBe(2000);
  });

  it('is a no-op when already accrued through today', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-05-20'),
        lastAccruedOn: '2026-05-23',
        dailyFeeCents: 1000,
        status: 'stored',
      },
      D('2026-05-23'),
    );
    expect(plan.daysToAccrue).toEqual([]);
    expect(plan.totalCents).toBe(0);
    expect(plan.newLastAccruedOn).toBe('2026-05-23');
  });

  it('accrues for pending_release too', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-05-23'),
        lastAccruedOn: null,
        dailyFeeCents: 500,
        status: 'pending_release',
      },
      D('2026-05-23'),
    );
    expect(plan.daysToAccrue).toHaveLength(1);
  });

  it.each(['released', 'transferred', 'disposed'] as const)(
    'does not accrue for %s status',
    (status) => {
      const plan = planDailyAccrual(
        { storageStartedAt: D('2026-05-20'), lastAccruedOn: null, dailyFeeCents: 1000, status },
        D('2026-05-25'),
      );
      expect(plan.daysToAccrue).toEqual([]);
      expect(plan.totalCents).toBe(0);
    },
  );

  it('does nothing (and does not advance) when the daily fee is zero', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-05-20'),
        lastAccruedOn: null,
        dailyFeeCents: 0,
        status: 'stored',
      },
      D('2026-05-25'),
    );
    expect(plan.daysToAccrue).toEqual([]);
    expect(plan.newLastAccruedOn).toBeNull();
  });

  it('returns no days when storage starts in the future', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('2026-06-01'),
        lastAccruedOn: null,
        dailyFeeCents: 1000,
        status: 'stored',
      },
      D('2026-05-23'),
    );
    expect(plan.daysToAccrue).toEqual([]);
  });

  it('caps a pathological backfill at MAX_BACKFILL_DAYS', () => {
    const plan = planDailyAccrual(
      {
        storageStartedAt: D('1990-01-01'),
        lastAccruedOn: null,
        dailyFeeCents: 100,
        status: 'stored',
      },
      D('2026-05-23'),
    );
    expect(plan.daysToAccrue.length).toBe(MAX_BACKFILL_DAYS);
  });
});

describe('computeLienEligibility', () => {
  it('is not eligible before the threshold', () => {
    const r = computeLienEligibility(D('2026-05-01'), D('2026-05-20'));
    expect(r.daysStored).toBe(19);
    expect(r.eligible).toBe(false);
  });

  it('becomes eligible exactly at the threshold', () => {
    const start = D('2026-05-01');
    const at = addUtcDays(toUtcDateString(start), LIEN_ELIGIBLE_AFTER_DAYS);
    const r = computeLienEligibility(start, D(at));
    expect(r.daysStored).toBe(LIEN_ELIGIBLE_AFTER_DAYS);
    expect(r.eligible).toBe(true);
  });

  it('never reports negative days stored', () => {
    const r = computeLienEligibility(D('2026-05-20'), D('2026-05-10'));
    expect(r.daysStored).toBe(0);
    expect(r.eligible).toBe(false);
  });
});

describe('sumFeeCents', () => {
  it('sums only non-soft-deleted fees', () => {
    expect(
      sumFeeCents([
        { amountCents: 1000, deletedAt: null },
        { amountCents: 500, deletedAt: null },
        { amountCents: 9999, deletedAt: new Date() },
      ]),
    ).toBe(1500);
  });

  it('is zero for an empty ledger', () => {
    expect(sumFeeCents([])).toBe(0);
  });
});

describe('constants', () => {
  it('only stored + pending_release accrue', () => {
    expect([...ACCRUING_STATUSES]).toEqual(['stored', 'pending_release']);
  });
});
