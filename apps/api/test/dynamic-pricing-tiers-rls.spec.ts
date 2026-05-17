/**
 * RLS isolation for dynamic_pricing_tiers (Moat #1 Dynamic Pricing).
 *
 * Mirrors the Build 6 account_rate_overrides RLS template:
 *   1) without GUC → SELECT returns zero rows (fail-closed)
 *   2) tenant A insert visible only to A
 *   3) tenant A cannot see B's rows
 *   4) UPDATE B's row from A context affects zero rows
 *   5) DELETE B's row from A context affects zero rows
 *   6) INSERT with foreign tenant_id rejected by RLS WITH CHECK
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — dynamic_pricing_tiers', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  const slugA = `dpt-rls-a-${Date.now()}`;
  const slugB = `dpt-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'DPT RLS A', tenantB, slugB, 'DPT RLS B'],
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
        await c.query('DELETE FROM dynamic_pricing_tiers WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
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

  it('without tenant context, SELECT returns no rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const res = await c.query('SELECT count(*)::int AS n FROM dynamic_pricing_tiers');
      expect(res.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('insert under tenant A creates exactly one row visible to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO dynamic_pricing_tiers (id, tenant_id, name, category, multiplier)
         VALUES ($1::uuid, $2::uuid, 'A weather', 'weather', 1.5)`,
        [uuidv7(), tenantA],
      );
      const res = await c.query<{ tenant_id: string; name: string }>(
        'SELECT tenant_id, name FROM dynamic_pricing_tiers',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's tiers", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO dynamic_pricing_tiers (id, tenant_id, name, category, multiplier)
         VALUES ($1::uuid, $2::uuid, 'B weather', 'weather', 2.0)`,
        [uuidv7(), tenantB],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM dynamic_pricing_tiers',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("UPDATE B's row from tenant A context affects zero rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query(
        'UPDATE dynamic_pricing_tiers SET multiplier = 9.99 WHERE tenant_id = $1',
        [tenantB],
      );
      expect(res.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("DELETE B's row from tenant A context affects zero rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query('DELETE FROM dynamic_pricing_tiers WHERE tenant_id = $1', [
        tenantB,
      ]);
      expect(res.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dynamic_pricing_tiers (id, tenant_id, name, category, multiplier)
           VALUES ($1::uuid, $2::uuid, 'cross', 'weather', 1.5)`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
