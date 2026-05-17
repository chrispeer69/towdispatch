/**
 * RLS isolation for account_rate_overrides (Admin Settings build 6 of 7).
 *
 * Mirrors the Build 2 service_rates template: two tenants, separate
 * transactions, proves the data wall plus the cross-tenant FK trigger.
 *
 * The test:
 *   1) creates two tenants via the admin pool, seeds each catalog, and
 *      picks one TOW service + account per tenant
 *   2) inserts an override under tenant A's GUC; asserts only A sees it
 *   3) seeds a B row from admin and asserts A cannot see it
 *   4) tenant A names B's account_id while passing its own tenant_id:
 *      the BEFORE trigger fn_account_rate_overrides_tenant_consistency
 *      rejects the insert
 *   5) tenant A names B's service_catalog_id while passing its own
 *      tenant_id: same trigger fires
 *   6) UPDATE B's row from tenant A's context → rowcount = 0
 *   7) without any GUC set, SELECT returns zero rows (fail-closed)
 *   8) INSERT with tenant_id = B from tenant A is rejected
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — account_rate_overrides', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let accountIdA: string;
  let accountIdB: string;
  let serviceIdA: string;
  let serviceIdB: string;
  const slugA = `aro-rls-a-${Date.now()}`;
  const slugB = `aro-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    accountIdA = uuidv7();
    accountIdB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'ARO RLS A', tenantB, slugB, 'ARO RLS B'],
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
      await c.query(
        'INSERT INTO accounts (id, tenant_id, name) VALUES ($1, $2, $3), ($4, $5, $6)',
        [accountIdA, tenantA, 'A acct', accountIdB, tenantB, 'B acct'],
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
        await c.query('DELETE FROM account_rate_overrides WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM accounts WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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
        `INSERT INTO account_rate_overrides
           (id, tenant_id, account_id, service_catalog_id, vehicle_class,
            override_type, override_value_cents, override_percent)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'light_duty',
                 'flat_price', 8000, NULL)`,
        [uuidv7(), tenantA, accountIdA, serviceIdA],
      );
      const res = await c.query<{ tenant_id: string; override_value_cents: number }>(
        'SELECT tenant_id, override_value_cents FROM account_rate_overrides',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's override rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO account_rate_overrides
           (id, tenant_id, account_id, service_catalog_id, vehicle_class,
            override_type, override_value_cents, override_percent)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'light_duty',
                 'flat_price', 9999, NULL)`,
        [uuidv7(), tenantB, accountIdB, serviceIdB],
      );
    } finally {
      adminC.release();
    }

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM account_rate_overrides',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('cross-tenant account_id injection is rejected by consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO account_rate_overrides
             (id, tenant_id, account_id, service_catalog_id, vehicle_class,
              override_type, override_value_cents, override_percent)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'light_duty',
                   'flat_price', 1, NULL)`,
          [uuidv7(), tenantA, accountIdB, serviceIdA],
        ),
      ).rejects.toThrowError(/does not match|does not exist/);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('cross-tenant service_catalog_id injection is rejected by consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO account_rate_overrides
             (id, tenant_id, account_id, service_catalog_id, vehicle_class,
              override_type, override_value_cents, override_percent)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'light_duty',
                   'flat_price', 1, NULL)`,
          [uuidv7(), tenantA, accountIdA, serviceIdB],
        ),
      ).rejects.toThrowError(/does not match|does not exist/);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it("UPDATE on tenant B's override from tenant A's context affects zero rows", async () => {
    const adminC = await admin.connect();
    let bRowId = '';
    try {
      const r = await adminC.query<{ id: string }>(
        'SELECT id FROM account_rate_overrides WHERE tenant_id = $1 LIMIT 1',
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
      const upd = await c.query(
        'UPDATE account_rate_overrides SET override_value_cents = 1 WHERE id = $1::uuid',
        [bRowId],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('without GUCs set, no rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT id FROM account_rate_overrides');
      expect(r.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('INSERT with tenant_id = B from tenant A is rejected', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO account_rate_overrides
             (id, tenant_id, account_id, service_catalog_id, vehicle_class,
              override_type, override_value_cents, override_percent)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'light_duty',
                   'flat_price', 1, NULL)`,
          [uuidv7(), tenantB, accountIdB, serviceIdB],
        ),
      ).rejects.toThrowError(/row-level security|policy|does not exist|does not match/i);
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
