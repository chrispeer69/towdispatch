/**
 * RLS isolation contract for the service_catalog table (Admin Settings
 * build 1 of 6). Same template as apps/api/test/rls.spec.ts — two tenants,
 * separate transactions, prove the data wall holds.
 *
 * The test:
 *   1) creates two tenants via the admin pool
 *   2) seeds the default catalog for each via fn_seed_default_service_catalog
 *      (the same SECURITY DEFINER helper the migration uses for backfill)
 *   3) opens an app-pool transaction in tenant A's GUC context and asserts:
 *      - SELECT returns only A's rows (not B's)
 *      - UPDATE targeting one of B's rows by id affects zero rows
 *      - INSERT with tenant_id = B is rejected by the WITH CHECK clause
 *   4) opens a second transaction with no GUC set and asserts SELECT is
 *      fail-closed (zero rows visible)
 *   5) confirms fn_seed_default_service_catalog is idempotent — running
 *      it a second time on a non-empty tenant returns 0 inserted
 *
 * Requires: DATABASE_URL (app_user) and DATABASE_ADMIN_URL (app_admin) at a
 * database with the migrations applied.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — service_catalog', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  const slugA = `sc-rls-a-${Date.now()}`;
  const slugB = `sc-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL!, max: 2 });
    app = new Pool({ connectionString: APP_URL!, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'SC RLS A', tenantB, slugB, 'SC RLS B'],
      );
      // Seed the default catalog for both tenants. The migration backfill
      // already ran during pnpm db:migrate, but these tenants are brand new
      // so they need an explicit invocation.
      await c.query('SELECT fn_seed_default_service_catalog($1)', [tenantA]);
      await c.query('SELECT fn_seed_default_service_catalog($1)', [tenantB]);
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

  it('seed inserted 46 rows for each tenant (sanity)', async () => {
    const c = await admin.connect();
    try {
      const a = await c.query<{ n: string }>(
        'SELECT COUNT(*)::text AS n FROM service_catalog WHERE tenant_id = $1',
        [tenantA],
      );
      const b = await c.query<{ n: string }>(
        'SELECT COUNT(*)::text AS n FROM service_catalog WHERE tenant_id = $1',
        [tenantB],
      );
      expect(Number(a.rows[0]?.n)).toBe(46);
      expect(Number(b.rows[0]?.n)).toBe(46);
    } finally {
      c.release();
    }
  });

  it('tenant A only sees its own service_catalog rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM service_catalog',
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's rows even when querying by id", async () => {
    // Pick a known B row id under admin context, then ask tenant A for it.
    const adminC = await admin.connect();
    let bRowId = '';
    try {
      const r = await adminC.query<{ id: string }>(
        'SELECT id FROM service_catalog WHERE tenant_id = $1 LIMIT 1',
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
      const sel = await c.query('SELECT id FROM service_catalog WHERE id = $1::uuid', [bRowId]);
      expect(sel.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("UPDATE on tenant B's row from tenant A's context affects zero rows", async () => {
    const adminC = await admin.connect();
    let bRowId = '';
    try {
      const r = await adminC.query<{ id: string }>(
        'SELECT id FROM service_catalog WHERE tenant_id = $1 LIMIT 1',
        [tenantB],
      );
      bRowId = r.rows[0]?.id as string;
    } finally {
      adminC.release();
    }

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query("UPDATE service_catalog SET name = 'hacked' WHERE id = $1::uuid", [
        bRowId,
      ]);
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
          `INSERT INTO service_catalog
             (id, tenant_id, code, name, category, calculation_unit)
             VALUES ($1::uuid, $2::uuid, 'MAL_SERVICE', 'Mal Service', 'fees_surcharges', 'per_call')`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrowError(/row-level security|new row violates|policy/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        // ignore
      }
      c.release();
    }
  });

  it('without GUCs set, no service_catalog rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT id FROM service_catalog');
      expect(r.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('fn_seed_default_service_catalog is idempotent on a populated tenant', async () => {
    const c = await admin.connect();
    try {
      const r = await c.query<{ inserted: number }>(
        'SELECT fn_seed_default_service_catalog($1)::int AS inserted',
        [tenantA],
      );
      expect(r.rows[0]?.inserted).toBe(0);
    } finally {
      c.release();
    }
  });
});
