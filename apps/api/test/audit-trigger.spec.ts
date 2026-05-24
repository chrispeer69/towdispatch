/**
 * Audit-trigger integration tests (Session 31 — SOC 2 CC7.2).
 *
 * Two things proven against a live database:
 *   1. The generic fn_audit_log() trigger fires on INSERT / UPDATE / DELETE of a
 *      sampled audited table (customers), capturing the actor from the GUC and
 *      the before/after row snapshots.
 *   2. The Session 31 backfill (0037) attached the audit trigger to the four
 *      previously-untriggered tenant tables.
 *
 * Self-skips when no database is configured (mirrors the *-rls.spec.ts suite).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

const BACKFILLED_TABLES = [
  'invoice_taxes',
  'job_ratings',
  'tenant_default_rate_sheets',
  'tracking_messages',
] as const;

interface AuditRow {
  action: string;
  actor_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
}

describeIfDb('audit trigger — fires on I/U/D and covers the backfill', () => {
  let admin: Pool;
  let app: Pool;
  let tenantId: string;
  const actorId = uuidv7();
  const customerId = uuidv7();
  const slug = `audit-trg-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantId = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')`, [
        tenantId,
        slug,
        'Audit Trigger Co',
      ]);
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
        await c.query('DELETE FROM customers WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
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

  it('captures INSERT, UPDATE, and DELETE with actor + snapshots', async () => {
    const c = await app.connect();
    try {
      // INSERT
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [actorId]);
      await c.query('INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, $3)', [
        customerId,
        tenantId,
        'Original Name',
      ]);
      await c.query('COMMIT');

      // UPDATE
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [actorId]);
      await c.query('UPDATE customers SET name = $1 WHERE id = $2', ['Renamed', customerId]);
      await c.query('COMMIT');

      // DELETE
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [actorId]);
      await c.query('DELETE FROM customers WHERE id = $1', [customerId]);
      await c.query('COMMIT');

      // Read the trail back through RLS as the tenant.
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const { rows } = await c.query<AuditRow>(
        `SELECT action, actor_id, before_state, after_state
           FROM audit_log
          WHERE resource_type = 'customers' AND resource_id = $1
          ORDER BY created_at`,
        [customerId],
      );
      await c.query('COMMIT');

      expect(rows.map((r) => r.action)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
      for (const r of rows) expect(r.actor_id).toBe(actorId);

      const [ins, upd, del] = rows;
      expect(ins?.after_state?.name).toBe('Original Name');
      expect(ins?.before_state).toBeNull();
      expect(upd?.before_state?.name).toBe('Original Name');
      expect(upd?.after_state?.name).toBe('Renamed');
      expect(del?.before_state?.name).toBe('Renamed');
      expect(del?.after_state).toBeNull();
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it.each(BACKFILLED_TABLES)('backfill: %s has its audit trigger attached', async (table) => {
    const c = await admin.connect();
    try {
      const { rows } = await c.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
        [table],
      );
      expect(rows.map((r) => r.tgname)).toContain(`trg_audit_${table}`);
    } finally {
      c.release();
    }
  });
});
