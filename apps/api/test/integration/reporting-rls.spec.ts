/**
 * Reporting RLS isolation test.
 *
 * Mirror of apps/api/test/rls.spec.ts but scoped to the new Session 14
 * surface: saved_reports, report_schedules, report_runs. A tenant must
 * not be able to see, update, or delete another tenant's saved_report.
 *
 * Why repeat the pattern: each new RLS-bearing table is its own attack
 * surface. The platform RLS test in test/rls.spec.ts is intentionally generic
 * (tenants/users/tracking_links). Per-module RLS tests keep the failure mode
 * specific so a regression points at the actual policy that broke.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('Reporting RLS isolation', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  let savedA: string;
  let savedB: string;
  const slugA = `rep-rls-a-${Date.now()}`;
  const slugB = `rep-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    userA = uuidv7();
    userB = uuidv7();
    savedA = uuidv7();
    savedB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'RepRLS A', tenantB, slugB, 'RepRLS B'],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, 'a@rep-rls.test', 'x', 'A', 'U', 'owner'),
                ($3, $4, 'b@rep-rls.test', 'x', 'B', 'U', 'owner')`,
        [userA, tenantA, userB, tenantB],
      );
      await c.query(
        `INSERT INTO saved_reports (id, tenant_id, report_id, name, filters)
         VALUES ($1, $2, 'revenue', 'A-report', '{}'::jsonb),
                ($3, $4, 'revenue', 'B-report', '{}'::jsonb)`,
        [savedA, tenantA, savedB, tenantB],
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
        await c.query('DELETE FROM saved_reports WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  it('tenant A only sees its own saved_reports', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);
      const res = await c.query<{ id: string; name: string }>('SELECT id, name FROM saved_reports');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.id).toBe(savedA);
      expect(res.rows[0]?.name).toBe('A-report');
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tenant A cannot SELECT or UPDATE tenant B saved_reports', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);
      const sel = await c.query('SELECT id FROM saved_reports WHERE id = $1::uuid', [savedB]);
      expect(sel.rows).toHaveLength(0);
      const upd = await c.query('UPDATE saved_reports SET name = $1 WHERE id = $2::uuid', [
        'hacked',
        savedB,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tenant A cannot INSERT a saved_report with tenant B id', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);
      await expect(
        c.query(
          `INSERT INTO saved_reports (id, tenant_id, report_id, name, filters)
           VALUES ($1::uuid, $2::uuid, 'revenue', 'Cross', '{}'::jsonb)`,
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

  it('without GUCs, no saved_report rows are visible', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const res = await c.query('SELECT id FROM saved_reports');
      expect(res.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
