import { describe, expect, it } from 'vitest';
import type { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { ActivationService } from './activation.service.js';
import type { CallerContext } from './caller-context.js';
import {
  type FakeDbState,
  makeFakeDbState,
  makeFakeTenantDb,
} from './fake-tenant-db.test-helper.js';

const ctx: CallerContext = {
  tenantId: '00000000-0000-0000-0000-0000000000aa',
  userId: '00000000-0000-0000-0000-0000000000bb',
  role: 'owner',
  requestId: 'req-1',
  ipAddress: '10.0.0.1',
  userAgent: 'spec',
};

function build(state: FakeDbState): ActivationService {
  return new ActivationService(makeFakeTenantDb(state) as unknown as TenantAwareDb);
}

describe('ActivationService', () => {
  it('emit() inserts a milestone', async () => {
    const state = makeFakeDbState();
    await build(state).emit(ctx, 'account_created', { slug: 'acme' });
    expect(state.events.map((e) => e.eventType)).toEqual(['account_created']);
    expect(state.events[0]?.metadata).toEqual({ slug: 'acme' });
  });

  it('emit() is idempotent on (tenant, event_type)', async () => {
    const state = makeFakeDbState();
    const svc = build(state);
    await svc.emit(ctx, 'account_created');
    await svc.emit(ctx, 'account_created');
    expect(state.events).toHaveLength(1);
  });

  it('list() returns events as ISO-dated DTOs', async () => {
    const state = makeFakeDbState({
      events: [
        {
          eventType: 'account_created',
          occurredAt: new Date('2026-05-23T00:00:00Z'),
          metadata: {},
        },
      ],
    });
    const out = await build(state).list(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.eventType).toBe('account_created');
    expect(out[0]?.occurredAt).toBe('2026-05-23T00:00:00.000Z');
  });

  it('refreshDerived emits derived milestones for present state and builds the checklist', async () => {
    const state = makeFakeDbState({
      counts: { verifiedUsers: 1, trucks: 2, drivers: 1, invites: 1, dispatchedJobs: 3 },
      events: [{ eventType: 'account_created', occurredAt: new Date(), metadata: {} }],
    });
    const checklist = await build(state).refreshDerivedAndBuildChecklist(ctx);
    expect(checklist).toEqual({
      accountCreated: true,
      emailVerified: true,
      companyInfoCompleted: false,
      firstUserInvited: true,
      firstTruckAdded: true,
      firstDriverAdded: true,
      firstJobDispatched: true,
    });
    const emitted = new Set(state.events.map((e) => e.eventType));
    expect(emitted.has('email_verified')).toBe(true);
    expect(emitted.has('first_truck_added')).toBe(true);
    expect(emitted.has('first_driver_added')).toBe(true);
    expect(emitted.has('first_user_invited')).toBe(true);
    expect(emitted.has('first_job_dispatched')).toBe(true);
  });

  it('refreshDerived emits nothing when no real state exists', async () => {
    const state = makeFakeDbState();
    const checklist = await build(state).refreshDerivedAndBuildChecklist(ctx);
    expect(checklist.emailVerified).toBe(false);
    expect(checklist.firstJobDispatched).toBe(false);
    expect(state.events).toHaveLength(0);
  });

  it('reflects company_info_completed from a prior explicit event', async () => {
    const state = makeFakeDbState({
      events: [{ eventType: 'company_info_completed', occurredAt: new Date(), metadata: {} }],
    });
    const checklist = await build(state).refreshDerivedAndBuildChecklist(ctx);
    expect(checklist.companyInfoCompleted).toBe(true);
  });
});
