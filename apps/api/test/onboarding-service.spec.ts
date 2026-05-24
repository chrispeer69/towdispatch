/**
 * Integration test for OnboardingService against a real Postgres (RLS-enforced
 * app_user pool). Skips automatically when DATABASE_URL / DATABASE_ADMIN_URL are
 * not set (local runs without a DB); runs in CI where migrations — including
 * 0036_onboarding.sql — have been applied.
 *
 * Seeds the parent rows (tenant, owner, and the activation-driving entities)
 * via the admin pool (superuser bypasses RLS); the service does all of its
 * onboarding_progress / tenant_activation_events work through the app_user pool
 * inside a tenant context, exactly as production does.
 */
import { uuidv7 } from '@ustowdispatch/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantAwareDb } from '../src/database/tenant-aware-db.service.js';
import {
  type CallerContext,
  OnboardingService,
} from '../src/modules/onboarding/onboarding.service.js';

const { Pool } = pg;

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const d = skip ? describe.skip : describe;

d('OnboardingService (integration)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let service: OnboardingService;
  let tenantId: string;
  let ownerId: string;
  let ctx: CallerContext;
  const stamp = Date.now();

  async function adminExec(sql: string, params: unknown[]): Promise<void> {
    const c = await admin.connect();
    try {
      await c.query(sql, params);
    } finally {
      c.release();
    }
  }

  async function adminScalar(sql: string, params: unknown[]): Promise<number> {
    const c = await admin.connect();
    try {
      const r = await c.query(sql, params);
      return (r.rows[0] as { n: number }).n;
    } finally {
      c.release();
    }
  }

  const ledgerCount = (eventType: string): Promise<number> =>
    adminScalar(
      'SELECT count(*)::int AS n FROM tenant_activation_events WHERE tenant_id = $1 AND event_type = $2',
      [tenantId, eventType],
    );

  const progressCount = (): Promise<number> =>
    adminScalar(
      'SELECT count(*)::int AS n FROM onboarding_progress WHERE tenant_id = $1 AND deleted_at IS NULL',
      [tenantId],
    );

  async function seedTenantWithOwner(): Promise<{ tenantId: string; ownerId: string }> {
    const t = uuidv7();
    const u = uuidv7();
    await adminExec("INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')", [
      t,
      `ob-${stamp}-${t.slice(0, 8)}`,
      'Onboarding Test Co',
    ]);
    await adminExec(
      "INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, 'x', 'Olivia', 'Owner', 'owner')",
      [u, t, `owner-${stamp}-${u.slice(0, 8)}@example.com`],
    );
    return { tenantId: t, ownerId: u };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    const seeded = await seedTenantWithOwner();
    tenantId = seeded.tenantId;
    ownerId = seeded.ownerId;
    // TenantAwareDb gained a read-replica pool + config (Session 44). Single
    // region here: replica pool == primary, no distinct replica configured.
    service = new OnboardingService(
      new TenantAwareDb(app, app, {
        readReplicaConfigured: false,
      } as unknown as import('../src/config/config.service.js').ConfigService),
    );
    ctx = { tenantId, userId: ownerId, requestId: uuidv7(), ipAddress: null, userAgent: null };
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('creates a progress row and emits account_created on first load', async () => {
    const state = await service.getState(ctx);
    expect(state.progress.currentStep).toBe('company_info');
    expect(state.milestones.account_created).toBe(true);
    expect(state.milestones.email_verified).toBe(false);
    expect(state.nextStep).toBe('company_info');
  });

  it('is idempotent — repeated loads do not duplicate rows', async () => {
    await service.getState(ctx);
    await service.getState(ctx);
    expect(await progressCount()).toBe(1);
    expect(await ledgerCount('account_created')).toBe(1);
  });

  it('persists company info, marks the milestone, and advances the step', async () => {
    const state = await service.saveStep(ctx, 'company_info', {
      data: { name: 'Acme Towing' },
      complete: true,
    });
    expect(state.milestones.company_info_completed).toBe(true);
    expect(state.progress.stepData.company_info).toEqual({ name: 'Acme Towing' });
    expect(state.progress.stepsCompleted).toContain('company_info');
    expect(state.nextStep).toBe('first_user');
  });

  it('detects an invited teammate (first_user_invited)', async () => {
    await adminExec(
      "INSERT INTO user_invites (id, tenant_id, email, role, invited_by, token_hash, expires_at) VALUES ($1, $2, $3, 'dispatcher', $4, $5, now() + interval '7 days')",
      [uuidv7(), tenantId, `invitee-${stamp}@example.com`, ownerId, `hash-${stamp}`],
    );
    const state = await service.recomputeState(ctx);
    expect(state.milestones.first_user_invited).toBe(true);
  });

  it('detects the first truck', async () => {
    await adminExec('INSERT INTO trucks (id, tenant_id, unit_number) VALUES ($1, $2, $3)', [
      uuidv7(),
      tenantId,
      'Unit 1',
    ]);
    const state = await service.recomputeState(ctx);
    expect(state.milestones.first_truck_added).toBe(true);
  });

  it('detects the first driver', async () => {
    await adminExec(
      'INSERT INTO drivers (id, tenant_id, first_name, last_name) VALUES ($1, $2, $3, $4)',
      [uuidv7(), tenantId, 'Sam', 'Carter'],
    );
    const state = await service.recomputeState(ctx);
    expect(state.milestones.first_driver_added).toBe(true);
  });

  it('detects the first dispatched job', async () => {
    await adminExec(
      "INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by, status) VALUES ($1, $2, $3, 'tow', '1 Main St', 'customer', 'dispatched')",
      [uuidv7(), tenantId, `J-${stamp}`],
    );
    const state = await service.recomputeState(ctx);
    expect(state.milestones.first_job_dispatched).toBe(true);
  });

  it('detects owner email verification', async () => {
    await adminExec('UPDATE users SET email_verified_at = now() WHERE id = $1', [ownerId]);
    const state = await service.recomputeState(ctx);
    expect(state.milestones.email_verified).toBe(true);
  });

  it('activates the free tier within the truck cap', async () => {
    // Exactly one truck so far (≤ 2) — activation is allowed.
    const state = await service.activateTier(ctx, { tier: 'free' });
    expect(state.progress.tier).toBe('free');
    expect(state.milestones.free_tier_activated).toBe(true);
  });

  it('rejects free-tier activation once over the truck cap', async () => {
    // Push the live truck count to 3 (> free cap of 2).
    await adminExec('INSERT INTO trucks (id, tenant_id, unit_number) VALUES ($1, $2, $3)', [
      uuidv7(),
      tenantId,
      'Unit 2',
    ]);
    await adminExec('INSERT INTO trucks (id, tenant_id, unit_number) VALUES ($1, $2, $3)', [
      uuidv7(),
      tenantId,
      'Unit 3',
    ]);
    await expect(service.activateTier(ctx, { tier: 'free' })).rejects.toThrow(/at most 2 trucks/i);
  });

  it('completes the wizard and emits onboarding_completed', async () => {
    const state = await service.complete(ctx);
    expect(state.progress.completedAt).not.toBeNull();
    expect(state.progress.currentStep).toBe('completed');
    expect(state.milestones.onboarding_completed).toBe(true);
    expect(state.nextStep).toBeNull();
  });

  it('refuses to complete before company info on a fresh tenant', async () => {
    const fresh = await seedTenantWithOwner();
    const freshCtx: CallerContext = {
      tenantId: fresh.tenantId,
      userId: fresh.ownerId,
      requestId: uuidv7(),
      ipAddress: null,
      userAgent: null,
    };
    await expect(service.complete(freshCtx)).rejects.toThrow(/company info/i);
  });
});
