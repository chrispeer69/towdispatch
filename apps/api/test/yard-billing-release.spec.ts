/**
 * Integration coverage for the yard billing + release flow (Session 54),
 * end to end against a real database:
 *
 *   assign vehicle to stall → billing run charges it → second run same day
 *   is a no-op (idempotent) → release workflow (initiate → verify ID →
 *   collect payment → gate release) frees the stall + closes the impound
 *   record → next billing run does NOT double-charge a released vehicle.
 *
 * Plus a release-workflow cancellation mid-flow.
 *
 * Self-skips when no database is configured.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service.js';
import { TenantAwareDb } from '../src/database/tenant-aware-db.service.js';
import { TransactionRunner } from '../src/database/transaction-runner.service.js';
import type { DispatchEventsService } from '../src/modules/dispatch/dispatch-events.service.js';
import { StorageBillingService } from '../src/modules/yard/billing/storage-billing.service.js';
import { ReleaseWorkflowService } from '../src/modules/yard/release/release-workflow.service.js';
import { YardStallService } from '../src/modules/yard/yard-stall.service.js';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const d = skip ? describe.skip : describe;

d('Yard billing + release (integration)', () => {
  let admin: Pool;
  let app: Pool;
  let stalls: YardStallService;
  let billing: StorageBillingService;
  let release: ReleaseWorkflowService;

  const tenant = uuidv7();
  const userId = uuidv7();
  const yard = uuidv7();
  const facility = uuidv7();
  const stall = uuidv7();
  const stall2 = uuidv7();
  const record = uuidv7();
  const record2 = uuidv7();
  const slug = `yard-int-${Date.now()}`;
  const ctx = { tenantId: tenant, userId, requestId: uuidv7() };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    const tenantDb = new TenantAwareDb(app, app, {
      readReplicaConfigured: false,
    } as unknown as ConfigService);
    const runner = new TransactionRunner(admin);
    const events = { emit: () => undefined } as unknown as DispatchEventsService;
    stalls = new YardStallService(tenantDb);
    billing = new StorageBillingService(runner);
    release = new ReleaseWorkflowService(tenantDb, events);

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1,$2,'Yard Int','active')`,
        [tenant, slug],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1,$2,$3,'x','Otto','Operator','owner')`,
        [userId, tenant, `${slug}@example.com`],
      );
      await c.query(
        `INSERT INTO impound_yards (id, tenant_id, name, code) VALUES ($1,$2,'Y','Y1')`,
        [yard, tenant],
      );
      // Two records, both stored, storage started 2 days ago.
      await c.query(
        `INSERT INTO impound_records (id, tenant_id, yard_id, daily_fee_cents, status, storage_started_at)
         VALUES ($1,$2,$3,0,'stored', now() - interval '2 days'),
                ($4,$2,$3,0,'stored', now() - interval '2 days')`,
        [record, tenant, yard, record2],
      );
      await c.query(`INSERT INTO yard_facilities (id, tenant_id, name) VALUES ($1,$2,'Fac')`, [
        facility,
        tenant,
      ]);
      await c.query(
        `INSERT INTO yard_stalls (id, tenant_id, facility_id, label) VALUES ($1,$2,$3,'A1'),($4,$2,$3,'A2')`,
        [stall, tenant, facility, stall2],
      );
      await c.query(
        `INSERT INTO storage_rate_cards
           (id, tenant_id, facility_id, name, vehicle_class, daily_rate_cents, free_days, effective_from)
         VALUES ($1,$2,$3,'Std','passenger',4000,0,'2020-01-01')`,
        [uuidv7(), tenant, facility],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        for (const t of [
          'storage_charges',
          'release_workflows',
          'storage_billing_runs',
          'yard_stalls',
          'storage_rate_cards',
          'yard_facilities',
          'impound_records',
          'impound_yards',
          'audit_log',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenant]);
        }
        await c.query('DELETE FROM users WHERE tenant_id = $1', [tenant]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id = $1', [tenant]);
        } finally {
          await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
      await admin.end();
    }
    if (app) await app.end();
  });

  it('charges a stall-assigned vehicle, is idempotent, then stops after release', async () => {
    const now = new Date();

    await stalls.assignVehicle(ctx, stall, record);

    const first = await billing.runForTenant(tenant, now);
    expect(first.chargesWritten).toBe(1);
    expect(first.totalChargedCents).toBe(4000);

    const second = await billing.runForTenant(tenant, now);
    expect(second.chargesWritten).toBe(0); // idempotent — same (impound, day)

    // Full release workflow.
    const wf = await release.initiate(ctx, record);
    await release.verifyId(ctx, wf.id, {
      payerName: 'Jane Owner',
      payerIdType: 'drivers_license',
      payerIdLast4: '1234',
    });
    await release.collectPayment(ctx, wf.id, { paymentAmountCents: 4000, paymentMethod: 'card' });
    const released = await release.gateRelease(ctx, wf.id);
    expect(released.status).toBe('gate_released');

    // Stall freed + impound closed.
    const c = await admin.connect();
    try {
      const stallRow = await c.query<{ occupied_by_impound_id: string | null }>(
        'SELECT occupied_by_impound_id FROM yard_stalls WHERE id = $1',
        [stall],
      );
      expect(stallRow.rows[0]?.occupied_by_impound_id).toBeNull();
      const recRow = await c.query<{ released_at: string | null; status: string }>(
        'SELECT released_at, status FROM impound_records WHERE id = $1',
        [record],
      );
      expect(recRow.rows[0]?.released_at).not.toBeNull();
      expect(recRow.rows[0]?.status).toBe('released');
    } finally {
      c.release();
    }

    // Next day: the released + un-stalled vehicle is not charged again.
    const nextDay = new Date(now.getTime() + 86_400_000);
    const third = await billing.runForTenant(tenant, nextDay);
    expect(third.chargesWritten).toBe(0);
  });

  it('supports cancellation mid-workflow', async () => {
    await stalls.assignVehicle(ctx, stall2, record2);
    const wf = await release.initiate(ctx, record2);
    await release.verifyId(ctx, wf.id, {
      payerName: 'Max Payne',
      payerIdType: 'state_id',
      payerIdLast4: '9',
    });
    const cancelled = await release.cancel(ctx, wf.id, { reason: 'owner did not show' });
    expect(cancelled.status).toBe('cancelled');

    // A re-initiate after cancellation starts a fresh live workflow.
    const fresh = await release.initiate(ctx, record2);
    expect(fresh.status).toBe('initiated');
    expect(fresh.id).not.toBe(wf.id);
  });
});
