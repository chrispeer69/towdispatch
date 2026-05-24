/**
 * RLS tenant isolation — Marketplace API (Session 46).
 *
 * Proves FORCE ROW LEVEL SECURITY on the two tenant-scoped marketplace tables
 * (marketplace_app_installs, marketplace_app_events): an app_user connection
 * scoped to tenant A can neither see, mutate, nor inject rows belonging to
 * tenant B. The global tables (developer_accounts, marketplace_apps) carry no
 * tenant_id and are intentionally not RLS-scoped. Mirrors
 * lien-processing-rls.spec.ts. Self-skips without a database.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const describeIfDb = !ADMIN_URL || !APP_URL ? describe.skip : describe;

describeIfDb('RLS tenant isolation — marketplace', () => {
  let admin: Pool;
  let app: Pool;
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const developerId = uuidv7();
  const appId = uuidv7();
  const installA = uuidv7();
  const installB = uuidv7();
  const eventA = uuidv7();
  const eventB = uuidv7();
  const slugA = `rls-mkt-a-${Date.now().toString(36)}`;
  const slugB = `rls-mkt-b-${Date.now().toString(36)}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, 'MKT RLS A', 'active'), ($3, $4, 'MKT RLS B', 'active')`,
        [tenantA, slugA, tenantB, slugB],
      );
      await c.query(
        `INSERT INTO developer_accounts (id, owner_user_email, company_name, password_hash)
         VALUES ($1, $2, 'RLS Devco', 'x')`,
        [developerId, `rls-dev-${Date.now()}@spec.test`],
      );
      await c.query(
        `INSERT INTO marketplace_apps
           (id, developer_id, slug, name, client_secret_hash, status, scopes, oauth_redirect_urls)
         VALUES ($1, $2, $3, 'RLS App', 'hash', 'listed', '[]'::jsonb, '[]'::jsonb)`,
        [appId, developerId, `rls-app-${Date.now().toString(36)}`],
      );
      await c.query(
        `INSERT INTO marketplace_app_installs (id, tenant_id, app_id, status)
         VALUES ($1, $2, $4, 'active'), ($3, $5, $4, 'active')`,
        [installA, tenantA, installB, appId, tenantB],
      );
      await c.query(
        `INSERT INTO marketplace_app_events (id, tenant_id, app_id, install_id, event_type)
         VALUES ($1, $2, $5, $6, 'install'), ($3, $4, $5, $7, 'install')`,
        [eventA, tenantA, eventB, tenantB, appId, installA, installB],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM marketplace_app_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM marketplace_app_installs WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM marketplace_apps WHERE id = $1', [appId]);
        await c.query('DELETE FROM developer_accounts WHERE id = $1', [developerId]);
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
  }, 60_000);

  const asTenant = async <T>(
    tenant: string,
    fn: (c: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> => {
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
  };

  it('installs: tenant A sees only its own', async () => {
    const rows = await asTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM marketplace_app_installs'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantA);
  });

  it('installs: UPDATE of B from A affects zero rows', async () => {
    const upd = await asTenant(tenantA, (c) =>
      c.query("UPDATE marketplace_app_installs SET status = 'uninstalled' WHERE id = $1::uuid", [
        installB,
      ]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('installs: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    await expect(
      asTenant(tenantA, (c) =>
        c.query(
          `INSERT INTO marketplace_app_installs (id, tenant_id, app_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [uuidv7(), tenantB, appId],
        ),
      ),
    ).rejects.toThrowError(/row-level security|policy/i);
  });

  it('events: tenant B sees only its own', async () => {
    const rows = await asTenant(tenantB, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM marketplace_app_events'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantB);
  });

  it('events: INSERT with a foreign tenant_id is rejected', async () => {
    await expect(
      asTenant(tenantB, (c) =>
        c.query(
          `INSERT INTO marketplace_app_events (id, tenant_id, app_id, event_type)
           VALUES ($1, $2, $3, 'error')`,
          [uuidv7(), tenantA, appId],
        ),
      ),
    ).rejects.toThrowError(/row-level security|policy/i);
  });
});
