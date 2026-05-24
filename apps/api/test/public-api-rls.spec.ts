/**
 * RLS isolation + cross-tenant FK guards for the Public API (Session 29)
 * tables.
 *
 *   api_keys                    — standard tenant-scoped FORCE RLS table.
 *   webhook_endpoints           — standard tenant-scoped FORCE RLS table.
 *   webhook_deliveries          — RLS + child consistency trigger (endpoint's
 *                                 tenant must match the row's tenant).
 *   public_api_idempotency_keys — RLS + child consistency trigger (api_key's
 *                                 tenant must match) + unique (tenant, key).
 *
 * Self-skips when no database is configured (mirrors impound-rls.spec.ts).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — public API', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  let keyA: string;
  let endpointA: string;
  let endpointB: string;
  const slugA = `papi-rls-a-${Date.now()}`;
  const slugB = `papi-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    userA = uuidv7();
    userB = uuidv7();
    keyA = uuidv7();
    endpointA = uuidv7();
    endpointB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'PAPI RLS A', tenantB, slugB, 'PAPI RLS B'],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'x', 'A', 'Owner', 'owner'), ($4, $5, $6, 'x', 'B', 'Owner', 'owner')`,
        [userA, tenantA, `a-${slugA}@spec.test`, userB, tenantB, `b-${slugB}@spec.test`],
      );
      await c.query(
        `INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by)
         VALUES ($1, $2, 'Key A', $3, 'hashA', '["jobs:read"]'::jsonb, $4)`,
        [keyA, tenantA, uuidv7().slice(0, 12), userA],
      );
      await c.query(
        `INSERT INTO webhook_endpoints (id, tenant_id, url, secret_encrypted, events, created_by)
         VALUES ($1, $2, 'https://a.example.com/hook', 'encA', ARRAY['job.created'], $3),
                ($4, $5, 'https://b.example.com/hook', 'encB', ARRAY['job.created'], $6)`,
        [endpointA, tenantA, userA, endpointB, tenantB, userB],
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
        await c.query('DELETE FROM webhook_deliveries WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM public_api_idempotency_keys WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM webhook_endpoints WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM api_keys WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM audit_log WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  async function withTenant<T>(
    tenant: string,
    fn: (c: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // ------------------------- api_keys -------------------------

  it('api_keys: tenant A sees only its own key', async () => {
    const rows = await withTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM api_keys'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantA);
  });

  it('api_keys: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM api_keys');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('api_keys: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by)
           VALUES ($1, $2, 'X', $3, 'h', '[]'::jsonb, $4)`,
          [uuidv7(), tenantB, uuidv7().slice(0, 12), userB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- webhook_endpoints -------------------------

  it('webhook_endpoints: A cannot UPDATE B (zero rows)', async () => {
    const upd = await withTenant(tenantA, (c) =>
      c.query('UPDATE webhook_endpoints SET active = false WHERE id = $1::uuid', [endpointB]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('webhook_endpoints: non-https url rejected by CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO webhook_endpoints (id, tenant_id, url, secret_encrypted, events, created_by)
           VALUES ($1, $2, 'http://insecure.example.com', 'e', ARRAY['job.created'], $3)`,
          [uuidv7(), tenantA, userA],
        ),
      ).rejects.toThrowError(/webhook_endpoints_url_https|check/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- webhook_deliveries -------------------------

  it('webhook_deliveries: foreign endpoint_id (B) under A is rejected by the child trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_type, payload)
           VALUES ($1, $2, $3, 'job.created', '{}'::jsonb)`,
          [uuidv7(), tenantA, endpointB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('webhook_deliveries: a delivery for A is visible only to A', async () => {
    await withTenant(tenantA, (c) =>
      c.query(
        `INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_type, payload)
         VALUES ($1, $2, $3, 'job.created', '{"id":"x"}'::jsonb)`,
        [uuidv7(), tenantA, endpointA],
      ),
    );
    const a = await withTenant(tenantA, (c) => c.query('SELECT id FROM webhook_deliveries'));
    expect(a.rows.length).toBeGreaterThanOrEqual(1);
    const b = await withTenant(tenantB, (c) => c.query('SELECT id FROM webhook_deliveries'));
    expect(b.rows).toHaveLength(0);
  });

  // ------------------------- idempotency keys -------------------------

  it('public_api_idempotency_keys: duplicate (tenant, key) blocked by unique index', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO public_api_idempotency_keys
           (id, tenant_id, api_key_id, idempotency_key, request_fingerprint, response_status, response_body)
         VALUES ($1, $2, $3, 'dupe-key', 'fp', 201, '{}'::jsonb)`,
        [uuidv7(), tenantA, keyA],
      );
      await expect(
        c.query(
          `INSERT INTO public_api_idempotency_keys
             (id, tenant_id, api_key_id, idempotency_key, request_fingerprint, response_status, response_body)
           VALUES ($1, $2, $3, 'dupe-key', 'fp2', 201, '{}'::jsonb)`,
          [uuidv7(), tenantA, keyA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
