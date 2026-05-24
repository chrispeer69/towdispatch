/**
 * RLS isolation + cross-tenant FK guards for the White-Label Customer Portal
 * (Session 32) tables:
 *
 *   tenant_branding              — tenant-scoped FORCE RLS + globally-unique
 *                                  custom_domain partial index.
 *   customer_portal_users        — RLS + consistency trigger (customer_id's
 *                                  tenant must match the row's tenant).
 *   customer_portal_auth_tokens  — RLS + child consistency trigger
 *                                  (portal_user_id's tenant must match).
 *
 * Self-skips when no database is configured (mirrors the other RLS specs).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — white-label customer portal', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let customerA: string;
  let customerB: string;
  let portalUserA: string;
  let portalUserB: string;
  const slugA = `wl-rls-a-${Date.now()}`;
  const slugB = `wl-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    customerA = uuidv7();
    customerB = uuidv7();
    portalUserA = uuidv7();
    portalUserB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'WL RLS A', tenantB, slugB, 'WL RLS B'],
      );
      await c.query(
        `INSERT INTO customers (id, tenant_id, name, email)
         VALUES ($1, $2, 'Cust A', 'a@example.com'), ($3, $4, 'Cust B', 'b@example.com')`,
        [customerA, tenantA, customerB, tenantB],
      );
      await c.query(
        `INSERT INTO customer_portal_users (id, tenant_id, customer_id, email, password_hash, email_verified_at)
         VALUES ($1, $2, $3, 'a@example.com', 'x', now()), ($4, $5, $6, 'b@example.com', 'x', now())`,
        [portalUserA, tenantA, customerA, portalUserB, tenantB, customerB],
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
        await c.query('DELETE FROM customer_portal_auth_tokens WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM customer_portal_users WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM tenant_branding WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM customers WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  // ------------------------- tenant_branding -------------------------

  it('tenant_branding: A can write + read only its own row', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO tenant_branding (tenant_id, primary_color) VALUES ($1, '#144399')`,
        [tenantA],
      );
      const r = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM tenant_branding');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tenant_branding: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query('INSERT INTO tenant_branding (tenant_id) VALUES ($1)', [tenantB]),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('tenant_branding: custom_domain is globally unique across tenants', async () => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenant_branding (tenant_id, custom_domain) VALUES ($1, 'dup.example.com')
         ON CONFLICT (tenant_id) DO UPDATE SET custom_domain = excluded.custom_domain`,
        [tenantA],
      );
      await expect(
        c.query(
          `INSERT INTO tenant_branding (tenant_id, custom_domain) VALUES ($1, 'dup.example.com')`,
          [tenantB],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- customer_portal_users -------------------------

  it('customer_portal_users: A sees only its own portal users', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM customer_portal_users',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('customer_portal_users: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        "UPDATE customer_portal_users SET email = 'pwned@x.com' WHERE id = $1::uuid",
        [portalUserB],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('customer_portal_users: a foreign customer_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO customer_portal_users (id, tenant_id, customer_id, email, password_hash)
           VALUES ($1, $2, $3, 'x@x.com', 'x')`,
          [uuidv7(), tenantA, customerB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- customer_portal_auth_tokens -------------------------

  it('customer_portal_auth_tokens: a foreign portal_user_id (B) under A is rejected by the child consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO customer_portal_auth_tokens
             (id, tenant_id, portal_user_id, purpose, token_hash, expires_at)
           VALUES ($1, $2, $3, 'email_verification', 'h', now() + interval '1 day')`,
          [uuidv7(), tenantA, portalUserB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('tenant_branding: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT tenant_id FROM customer_portal_users');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });
});
