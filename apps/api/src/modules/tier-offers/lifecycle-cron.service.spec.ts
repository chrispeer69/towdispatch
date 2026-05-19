/**
 * Unit tests for TierOfferLifecycleCron.
 *
 * The cron's tick body is a TransactionRunner.runAsAdmin closure that
 * issues three UPDATE statements + one query. We mock TransactionRunner
 * with a chainable stub so we can verify each branch fires the right
 * filter and produces the right counts in the result.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../../config/config.service.js';
import { TierOfferLifecycleCron } from './lifecycle-cron.service.js';

interface QueryStub {
  tierOffers?: { findMany?: ReturnType<typeof vi.fn> };
}

function makeStubDb(args: {
  activatedRows?: { id: string }[];
  concludedRows?: { id: string }[];
  expiredRows?: { id: string }[];
  offersPastDeadline?: { id: string }[];
}) {
  const updateOrder: string[] = [];
  const update = vi.fn(() => {
    let lastSet: Record<string, unknown> | undefined;
    const chain = {
      set(setArg: Record<string, unknown>) {
        lastSet = setArg;
        return chain;
      },
      where() {
        return chain;
      },
      returning: async () => {
        // The cron does three updates in order:
        //   1. status: event_active   ← offers activated
        //   2. status: event_concluded ← offers concluded
        //   3. status: expired         ← recipients expired
        if (lastSet?.status === 'event_active') {
          updateOrder.push('activate');
          return args.activatedRows ?? [];
        }
        if (lastSet?.status === 'event_concluded') {
          updateOrder.push('conclude');
          return args.concludedRows ?? [];
        }
        if (lastSet?.status === 'expired') {
          updateOrder.push('expire');
          return args.expiredRows ?? [];
        }
        return [];
      },
    };
    return chain;
  });
  const query: QueryStub = {
    tierOffers: {
      findMany: vi.fn(async () => args.offersPastDeadline ?? []),
    },
  };
  return { db: { update, query }, updateOrder };
}

function configWith(cronEnabled: boolean): ConfigService {
  return {
    tierOffer: { cronEnabled, webhookPublicKey: null },
  } as unknown as ConfigService;
}

describe('TierOfferLifecycleCron', () => {
  let cron: TierOfferLifecycleCron;

  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    cron = new TierOfferLifecycleCron(undefined as any, configWith(true));
  });

  it('cronTick exits early when env flag is disabled', async () => {
    const admin = { runAsAdmin: vi.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    cron = new TierOfferLifecycleCron(admin as any, configWith(false));
    const out = await cron.cronTick();
    expect(out).toBeNull();
    expect(admin.runAsAdmin).not.toHaveBeenCalled();
  });

  it('runs three updates and reports counts in order', async () => {
    const stub = makeStubDb({
      activatedRows: [{ id: 'o1' }, { id: 'o2' }],
      concludedRows: [{ id: 'o3' }],
      offersPastDeadline: [{ id: 'o4' }],
      expiredRows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
    });
    const admin = {
      runAsAdmin: vi.fn(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
        fn(stub.db),
      ),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    cron = new TierOfferLifecycleCron(admin as any, configWith(true));
    const out = await cron.tick();
    expect(out).toEqual({
      offersActivated: 2,
      offersConcluded: 1,
      recipientsExpired: 3,
    });
    expect(stub.updateOrder).toEqual(['activate', 'conclude', 'expire']);
  });

  it('skips the recipient-expire step when no offers are past deadline', async () => {
    const stub = makeStubDb({ offersPastDeadline: [] });
    const admin = {
      runAsAdmin: vi.fn(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
        fn(stub.db),
      ),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    cron = new TierOfferLifecycleCron(admin as any, configWith(true));
    const out = await cron.tick();
    expect(out.recipientsExpired).toBe(0);
    expect(stub.updateOrder).toEqual(['activate', 'conclude']);
  });

  it('is idempotent — re-running with no eligible rows yields all zeros', async () => {
    const stub = makeStubDb({});
    const admin = {
      runAsAdmin: vi.fn(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
        fn(stub.db),
      ),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    cron = new TierOfferLifecycleCron(admin as any, configWith(true));
    const out = await cron.tick();
    expect(out).toEqual({
      offersActivated: 0,
      offersConcluded: 0,
      recipientsExpired: 0,
    });
  });
});
