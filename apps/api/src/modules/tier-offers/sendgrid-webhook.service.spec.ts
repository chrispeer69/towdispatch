/**
 * Unit tests for TierOfferWebhookService.
 *
 * The service depends only on TransactionRunner. We mock its
 * `runAsAdmin` to capture the work function, supply a stub `db`
 * with chainable `update().set().where().returning()` shape, and
 * verify the right state transitions per event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TierOfferWebhookService } from './sendgrid-webhook.service.js';

type StubReturning = { id: string }[];

function makeAdminStub(updateReturning: StubReturning = [{ id: 'r1' }]) {
  const setSpy = vi.fn();
  const whereSpy = vi.fn();
  const returningSpy = vi.fn(async () => updateReturning);
  const updateChain = {
    set: (arg: unknown) => {
      setSpy(arg);
      return updateChain;
    },
    where: (arg: unknown) => {
      whereSpy(arg);
      return updateChain;
    },
    returning: () => returningSpy(),
  };
  const db = {
    update: vi.fn(() => updateChain),
  };
  const admin = {
    runAsAdmin: vi.fn(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)),
  };
  return { admin, db, setSpy, whereSpy, returningSpy };
}

describe('TierOfferWebhookService', () => {
  let svc: TierOfferWebhookService;

  beforeEach(() => {
    // Constructor only stashes the runner; replaced per test.
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    svc = new TierOfferWebhookService(undefined as any);
  });

  it('skips events without a recipientId', async () => {
    const { admin } = makeAdminStub();
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = admin;
    const out = await svc.handleEvents([{ event: 'delivered', email: 'foo@example.com' }]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(1);
    expect(admin.runAsAdmin).not.toHaveBeenCalled();
  });

  it('skips events for other features (kind mismatch)', async () => {
    const { admin } = makeAdminStub();
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = admin;
    const out = await svc.handleEvents([
      {
        event: 'delivered',
        recipientId: 'r1',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'some-other-feature',
      },
    ]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('applies a delivered event and returns counts', async () => {
    const stub = makeAdminStub([{ id: 'r1' }]);
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = stub.admin;
    const out = await svc.handleEvents([
      {
        event: 'delivered',
        timestamp: 1763500000,
        recipientId: 'r1',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'tier-offer-invitation',
      },
    ]);
    expect(out.applied).toBe(1);
    expect(out.skipped).toBe(0);
    expect(out.failed).toBe(0);
    // The set call should target status='delivered'.
    expect(stub.setSpy).toHaveBeenCalled();
    const firstCall = stub.setSpy.mock.calls[0];
    if (!firstCall) throw new Error('expected setSpy to be called at least once');
    const firstSet = firstCall[0] as Record<string, unknown>;
    expect(firstSet.status).toBe('delivered');
  });

  it('applies an open event with the right target status', async () => {
    const stub = makeAdminStub([{ id: 'r1' }]);
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = stub.admin;
    const out = await svc.handleEvents([
      {
        event: 'open',
        timestamp: 1763500000,
        recipientId: 'r1',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'tier-offer-invitation',
      },
    ]);
    expect(out.applied).toBe(1);
    const openCall = stub.setSpy.mock.calls[0];
    if (!openCall) throw new Error('expected setSpy to be called');
    const firstSet = openCall[0] as Record<string, unknown>;
    expect(firstSet.status).toBe('opened');
  });

  it('applies a bounce event and flips status to bounced', async () => {
    const stub = makeAdminStub([{ id: 'r1' }]);
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = stub.admin;
    const out = await svc.handleEvents([
      {
        event: 'bounce',
        recipientId: 'r1',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'tier-offer-invitation',
      },
    ]);
    expect(out.applied).toBe(1);
    const bounceCall = stub.setSpy.mock.calls[0];
    if (!bounceCall) throw new Error('expected setSpy to be called');
    const firstSet = bounceCall[0] as Record<string, unknown>;
    expect(firstSet.status).toBe('bounced');
  });

  it('skips click and unsubscribe events without touching the db', async () => {
    const stub = makeAdminStub();
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = stub.admin;
    const out = await svc.handleEvents([
      { event: 'click', recipientId: 'r1', kind: 'tier-offer-invitation' },
      { event: 'unsubscribe', recipientId: 'r1', kind: 'tier-offer-invitation' },
    ]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(2);
    expect(stub.admin.runAsAdmin).not.toHaveBeenCalled();
  });

  it('reports skipped (not applied) when the UPDATE returns no rows (idempotency)', async () => {
    const stub = makeAdminStub([]); // simulate the row being already accepted
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = stub.admin;
    const out = await svc.handleEvents([
      {
        event: 'delivered',
        recipientId: 'r1',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'tier-offer-invitation',
      },
    ]);
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('catches errors per-event without tanking the batch', async () => {
    const admin = {
      runAsAdmin: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('boom');
        })
        .mockImplementationOnce(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
          fn({
            update: () => ({
              set: () => ({
                where: () => ({ returning: async () => [{ id: 'r2' }] }),
              }),
            }),
          }),
        ),
    };
    // biome-ignore lint/suspicious/noExplicitAny: stub
    (svc as any).admin = admin;
    const out = await svc.handleEvents([
      {
        event: 'delivered',
        recipientId: 'r1',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'tier-offer-invitation',
      },
      {
        event: 'delivered',
        recipientId: 'r2',
        offerId: 'o1',
        tenantId: 't1',
        kind: 'tier-offer-invitation',
      },
    ]);
    expect(out.failed).toBe(1);
    expect(out.applied).toBe(1);
    expect(out.skipped).toBe(0);
  });
});
