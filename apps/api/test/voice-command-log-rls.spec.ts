/**
 * RLS tenant isolation — voice_command_log (Session 45).
 *
 * Verifies FORCE ROW LEVEL SECURITY on the voice audit table: a tenant sees
 * only its own commands, can't update another tenant's rows, can't insert a
 * row tagged with a foreign tenant_id, sees nothing without a tenant GUC,
 * and can't reference a driver from another tenant (the consistency trigger
 * surfaces it as "does not exist" because RLS hides foreign drivers).
 *
 * Self-skips when DATABASE_URL isn't set — matches every other *-rls spec.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const describeIfDb = !ADMIN_URL || !APP_URL ? describe.skip : describe;

describeIfDb('RLS tenant isolation — voice_command_log', () => {
  let admin: Pool;
  let app: Pool;
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const driverA = uuidv7();
  const driverB = uuidv7();
  const rowA = uuidv7();
  const rowB = uuidv7();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [
          tenantA,
          `voice-rls-a-${Date.now()}`,
          'Voice RLS A',
          tenantB,
          `voice-rls-b-${Date.now()}`,
          'Voice RLS B',
        ],
      );
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
         VALUES ($1, $2, 'A', 'Driver', 'A', true), ($3, $4, 'B', 'Driver', 'A', true)`,
        [driverA, tenantA, driverB, tenantB],
      );
      // Seed one command per tenant.
      await c.query(
        `INSERT INTO voice_command_log (id, tenant_id, driver_id, command_text, recognized_intent)
         VALUES ($1, $2, $3, 'en route', 'en_route'), ($4, $5, $6, 'en route', 'en_route')`,
        [rowA, tenantA, driverA, rowB, tenantB, driverB],
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM voice_command_log WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM drivers WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        await c.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
        await c.query('COMMIT');
      } finally {
        c.release();
      }
      await admin.end();
    }
    if (app) await app.end();
  });

  async function asTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } finally {
      c.release();
    }
  }

  it('A sees only its own command', async () => {
    const rows = await asTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM voice_command_log'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantA);
  });

  it("A cannot UPDATE B's row", async () => {
    const upd = await asTenant(tenantA, (c) =>
      c.query("UPDATE voice_command_log SET action_taken = 'pwned' WHERE id = $1::uuid", [rowB]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('WITH CHECK blocks inserting a row tagged with a foreign tenant_id', async () => {
    await expect(
      asTenant(tenantA, (c) =>
        c.query(
          `INSERT INTO voice_command_log (id, tenant_id, driver_id, command_text, recognized_intent)
           VALUES ($1, $2, $3, 'x', 'en_route')`,
          [uuidv7(), tenantB, driverB],
        ),
      ),
    ).rejects.toThrowError(/row-level security|policy/i);
  });

  it('returns zero rows with no tenant GUC (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT id FROM voice_command_log');
      expect(r.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('rejects a cross-tenant driver_id (consistency trigger)', async () => {
    await expect(
      asTenant(tenantA, (c) =>
        c.query(
          `INSERT INTO voice_command_log (id, tenant_id, driver_id, command_text, recognized_intent)
           VALUES ($1, $2, $3, 'x', 'en_route')`,
          [uuidv7(), tenantA, driverB], // driverB belongs to tenantB
        ),
      ),
    ).rejects.toThrowError(/does not exist|does not match/i);
  });
});
