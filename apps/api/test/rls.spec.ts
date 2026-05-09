import { uuidv7 } from '@towcommand/db';
import argon2 from 'argon2';
import { Pool } from 'pg';
/**
 * RLS isolation contract test.
 *
 * This is the test that, if it fails, signals a P0. RLS is the only thing
 * standing between tenant A and tenant B's data, and a regression here is
 * the kind of thing that ends a B2B SaaS company.
 *
 * The test:
 *   1) creates two tenants (A and B) with one user each, via the admin pool
 *   2) opens two app-pool transactions, one set to tenant A, one to tenant B
 *   3) asserts each side sees only its own tenant row, only its own user
 *   4) asserts an attempt to write a user with another tenant's id fails
 *   5) asserts a transaction with no GUC set sees zero tenant rows
 *
 * Requires: DATABASE_URL (app_user) and DATABASE_ADMIN_URL (app_admin) point
 * at a database where the migrations + RLS policies have been applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;

const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  const slugA = `rls-a-${Date.now()}`;
  const slugB = `rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL!, max: 2 });
    app = new Pool({ connectionString: APP_URL!, max: 4 });

    const passwordHash = await argon2.hash('Test-pw-1234!', {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    tenantA = uuidv7();
    tenantB = uuidv7();
    userA = uuidv7();
    userB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'Tenant A', tenantB, slugB, 'Tenant B'],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, 'a@rls.test', $3, 'A', 'User', 'owner'),
                ($4, $5, 'b@rls.test', $3, 'B', 'User', 'owner')`,
        [userA, tenantA, passwordHash, userB, tenantB],
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
        await c.query('DELETE FROM sessions WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  it('tenant A only sees its own tenant row', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);
      const res = await c.query<{ id: string; slug: string }>('SELECT id, slug FROM tenants');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.id).toBe(tenantA);
      expect(res.rows[0]?.slug).toBe(slugA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tenant A only sees its own users', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);
      const res = await c.query<{ id: string; email: string }>('SELECT id, email FROM users');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.id).toBe(userA);
      expect(res.rows[0]?.email).toBe('a@rls.test');
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tenant B only sees its own users (independent connection)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userB]);
      const res = await c.query<{ id: string }>('SELECT id FROM users');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.id).toBe(userB);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('attempt to insert a user with another tenant_id is rejected by RLS WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);

      await expect(
        c.query(
          `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
           VALUES ($1, $2, 'malicious@rls.test', 'x', 'Mal', 'Icious', 'owner')`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrowError(/row-level security|new row violates|policy/i);
    } finally {
      // The failed insert aborts the transaction; just release.
      try {
        await c.query('ROLLBACK');
      } catch {
        // ignore
      }
      c.release();
    }
  });

  it('an UPDATE that crosses tenants is rejected', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);

      const res = await c.query(`UPDATE users SET first_name = 'hacked' WHERE id = $1`, [userB]);
      // RLS turns the cross-tenant target row invisible, so 0 rows are
      // affected. No exception, but no escape either.
      expect(res.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('without GUCs set, no tenant rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const tenantRes = await c.query('SELECT id FROM tenants');
      const userRes = await c.query('SELECT id FROM users');
      expect(tenantRes.rows).toHaveLength(0);
      expect(userRes.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
