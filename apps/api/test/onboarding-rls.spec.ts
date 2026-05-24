/**
 * RLS isolation + idempotency contract for the onboarding tables
 * (Session 25). Mirrors the user_invites RLS template:
 *
 *   1) Without app.current_tenant_id, no rows visible (fail-closed).
 *   2) Tenant A cannot see tenant B's onboarding_progress / activation events.
 *   3) UPDATE from A on B's progress row affects zero rows.
 *   4) INSERT with a foreign tenant_id is rejected by WITH CHECK.
 *   5) tenant_activation_events (tenant_id, event_type) is unique — a second
 *      insert of the same milestone is rejected (idempotency floor).
 *   6) onboarding_progress allows one live row per tenant (partial unique).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — onboarding', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let ownerA: string;
  let ownerB: string;
  let progressA: string;
  let progressB: string;
  let eventA: string;
  const slugA = `onb-rls-a-${Date.now()}`;
  const slugB = `onb-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    ownerA = uuidv7();
    ownerB = uuidv7();
    progressA = uuidv7();
    progressB = uuidv7();
    eventA = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'Onb RLS A', tenantB, slugB, 'Onb RLS B'],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'x', 'Own', 'A', 'owner'),
                ($4, $5, $6, 'x', 'Own', 'B', 'owner')`,
        [ownerA, tenantA, `${slugA}-owner@spec.test`, ownerB, tenantB, `${slugB}-owner@spec.test`],
      );
      await c.query(
        `INSERT INTO onboarding_progress (id, tenant_id, current_step, steps_completed, created_by)
         VALUES ($1, $2, 'verify_email', ARRAY['account'], $3),
                ($4, $5, 'verify_email', ARRAY['account'], $6)`,
        [progressA, tenantA, ownerA, progressB, tenantB, ownerB],
      );
      await c.query(
        `INSERT INTO tenant_activation_events (id, tenant_id, event_type, created_by)
         VALUES ($1, $2, 'account_created', $3)`,
        [eventA, tenantA, ownerA],
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
        await c.query('DELETE FROM tenant_activation_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM onboarding_progress WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM audit_log WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
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

  it('without GUCs set, no onboarding_progress rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM onboarding_progress');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's progress or activation events", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const prog = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM onboarding_progress',
      );
      expect(prog.rows).toHaveLength(1);
      expect(prog.rows[0]?.tenant_id).toBe(tenantA);
      const events = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM tenant_activation_events',
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("UPDATE on tenant B's progress from tenant A affects zero rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        "UPDATE onboarding_progress SET current_step = 'completed' WHERE id = $1::uuid",
        [progressB],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('INSERT with tenant_id = B from tenant A is rejected by RLS WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO tenant_activation_events (id, tenant_id, event_type)
           VALUES ($1::uuid, $2::uuid, 'email_verified')`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('tenant_activation_events (tenant_id, event_type) is unique — duplicate milestone rejected', async () => {
    const c = await admin.connect();
    try {
      await expect(
        c.query(
          `INSERT INTO tenant_activation_events (id, tenant_id, event_type, created_by)
           VALUES ($1::uuid, $2::uuid, 'account_created', $3::uuid)`,
          [uuidv7(), tenantA, ownerA],
        ),
      ).rejects.toThrowError(/duplicate key|unique constraint/i);
    } finally {
      c.release();
    }
  });

  it('onboarding_progress allows only one live row per tenant', async () => {
    const c = await admin.connect();
    try {
      await expect(
        c.query(
          `INSERT INTO onboarding_progress (id, tenant_id, current_step, created_by)
           VALUES ($1::uuid, $2::uuid, 'account', $3::uuid)`,
          [uuidv7(), tenantA, ownerA],
        ),
      ).rejects.toThrowError(/duplicate key|unique constraint/i);
    } finally {
      c.release();
    }
  });
});
