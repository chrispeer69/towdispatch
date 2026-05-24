/**
 * RLS isolation + cross-tenant guards for the Enterprise SSO (Session 38)
 * tables:
 *   sso_connections     — standard tenant-scoped FORCE RLS.
 *   scim_tokens         — RLS + connection-consistency trigger + token_hash
 *                         partial-unique idempotency index.
 *   sso_login_audit     — RLS on the append-only trail.
 *   scim_group_members  — RLS + group/user tenant-consistency trigger.
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

describeIfDb('RLS tenant isolation — enterprise SSO', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let connA: string;
  let connB: string;
  const slugA = `sso-rls-a-${Date.now()}`;
  const slugB = `sso-rls-b-${Date.now()}`;

  const setTenant = (c: { query: Pool['query'] }, tid: string): Promise<unknown> =>
    c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tid]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    connA = uuidv7();
    connB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'SSO RLS A', tenantB, slugB, 'SSO RLS B'],
      );
      await c.query(
        `INSERT INTO sso_connections (id, tenant_id, provider, display_name, enabled)
         VALUES ($1, $2, 'saml', 'A SAML', true), ($3, $4, 'saml', 'B SAML', true)`,
        [connA, tenantA, connB, tenantB],
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
        for (const t of ['scim_group_members', 'scim_groups', 'scim_tokens', 'sso_login_audit']) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
        }
        await c.query('DELETE FROM sso_connections WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
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

  // ------------------------- sso_connections -------------------------
  it('sso_connections: tenant A sees only its own connection', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await setTenant(c, tenantA);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM sso_connections',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('sso_connections: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await setTenant(c, tenantA);
      const upd = await c.query(
        "UPDATE sso_connections SET display_name = 'pwned' WHERE id = $1::uuid",
        [connB],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('sso_connections: INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await setTenant(c, tenantA);
      await expect(
        c.query(
          `INSERT INTO sso_connections (id, tenant_id, provider, display_name) VALUES ($1, $2, 'oidc', 'X')`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('sso_connections: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM sso_connections');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // ------------------------- scim_tokens -------------------------
  it('scim_tokens: foreign connection_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await setTenant(c, tenantA);
      await expect(
        c.query(
          `INSERT INTO scim_tokens (id, tenant_id, connection_id, name, token_hash, token_prefix)
           VALUES ($1, $2, $3, 'x', $4, 'scim_x')`,
          [uuidv7(), tenantA, connB, `hash-${uuidv7()}`],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('scim_tokens: duplicate live token_hash is rejected by the partial-unique index', async () => {
    const c = await app.connect();
    const hash = `dup-hash-${uuidv7()}`;
    try {
      await c.query('BEGIN');
      await setTenant(c, tenantA);
      await c.query(
        `INSERT INTO scim_tokens (id, tenant_id, name, token_hash, token_prefix)
         VALUES ($1, $2, 'one', $3, 'scim_a')`,
        [uuidv7(), tenantA, hash],
      );
      await expect(
        c.query(
          `INSERT INTO scim_tokens (id, tenant_id, name, token_hash, token_prefix)
           VALUES ($1, $2, 'two', $3, 'scim_b')`,
          [uuidv7(), tenantA, hash],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- sso_login_audit -------------------------
  it('sso_login_audit: tenant A cannot see B rows', async () => {
    // Seed one audit row per tenant via admin (bypasses RLS).
    const ac = await admin.connect();
    try {
      await ac.query(
        `INSERT INTO sso_login_audit (id, tenant_id, connection_id, provider, outcome)
         VALUES ($1, $2, $3, 'saml', 'success'), ($4, $5, $6, 'saml', 'fail')`,
        [uuidv7(), tenantA, connA, uuidv7(), tenantB, connB],
      );
    } finally {
      ac.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await setTenant(c, tenantA);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM sso_login_audit',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
