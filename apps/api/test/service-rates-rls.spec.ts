/**
 * RLS isolation contract for the service_rates table (Admin Settings build
 * 2 of 6). Mirrors the service_catalog template: two tenants, separate
 * transactions, proves the data wall plus the cross-tenant FK trigger.
 *
 * The test:
 *   1) creates two tenants via the admin pool and seeds their catalogs
 *   2) under admin context, picks one service per tenant
 *   3) inserts a rate row for each tenant under tenant A's app GUC context;
 *      asserts only A's row is visible to A, and B's row is invisible
 *   4) attempts to insert a rate row into service_rates that names B's
 *      service_id while tenant A's GUC is set — the BEFORE trigger
 *      fn_service_rates_tenant_consistency must reject it
 *   5) attempts to update B's row from A's context — rowcount = 0
 *   6) without any GUC set, SELECT returns zero rows (fail-closed)
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — service_rates', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let serviceIdA: string;
  let serviceIdB: string;
  const slugA = `sr-rls-a-${Date.now()}`;
  const slugB = `sr-rls-b-${Date.now()}`;

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
        [tenantA, slugA, 'SR RLS A', tenantB, slugB, 'SR RLS B'],
      );
      await c.query('SELECT fn_seed_default_service_catalog($1)', [tenantA]);
      await c.query('SELECT fn_seed_default_service_catalog($1)', [tenantB]);
      const a = await c.query<{ id: string }>(
        `SELECT id FROM service_catalog WHERE tenant_id = $1 AND code = 'TOW' LIMIT 1`,
        [tenantA],
      );
      const b = await c.query<{ id: string }>(
        `SELECT id FROM service_catalog WHERE tenant_id = $1 AND code = 'TOW' LIMIT 1`,
        [tenantB],
      );
      serviceIdA = a.rows[0]?.id as string;
      serviceIdB = b.rows[0]?.id as string;
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
        await c.query('DELETE FROM service_rates WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM service_catalog WHERE tenant_id IN ($1, $2)', [
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

  it('insert under tenant A context creates exactly one row visible to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO service_rates (id, tenant_id, service_id, vehicle_class, price_cents)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'light_duty', 9500)`,
        [uuidv7(), tenantA, serviceIdA],
      );
      const res = await c.query<{ tenant_id: string; price_cents: string }>(
        'SELECT tenant_id, price_cents FROM service_rates',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's rate rows", async () => {
    // Seed a B row from admin so RLS has something to hide.
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO service_rates (id, tenant_id, service_id, vehicle_class, price_cents)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'light_duty', 12345)`,
        [uuidv7(), tenantB, serviceIdB],
      );
    } finally {
      adminC.release();
    }

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM service_rates',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('cross-tenant FK injection is rejected by the consistency trigger', async () => {
    // Tenant A names B's service_id while passing its own tenant_id — the
    // BEFORE INSERT trigger fn_service_rates_tenant_consistency must raise.
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO service_rates (id, tenant_id, service_id, vehicle_class, price_cents)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'light_duty', 50000)`,
          [uuidv7(), tenantA, serviceIdB],
        ),
      ).rejects.toThrowError(/tenant_id .* does not match service_catalog/);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it("UPDATE on tenant B's rate row from tenant A's context affects zero rows", async () => {
    const adminC = await admin.connect();
    let bRowId = '';
    try {
      const r = await adminC.query<{ id: string }>(
        'SELECT id FROM service_rates WHERE tenant_id = $1 LIMIT 1',
        [tenantB],
      );
      bRowId = r.rows[0]?.id as string;
      expect(bRowId).toBeTruthy();
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query('UPDATE service_rates SET price_cents = 1 WHERE id = $1::uuid', [
        bRowId,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('without GUCs set, no service_rates rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT id FROM service_rates');
      expect(r.rows).toHaveLength(0);
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
          `INSERT INTO service_rates (id, tenant_id, service_id, vehicle_class, price_cents)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'light_duty', 1)`,
          [uuidv7(), tenantB, serviceIdB],
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
});
