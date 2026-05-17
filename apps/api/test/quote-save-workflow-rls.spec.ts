/**
 * RLS isolation for quote_save_workflow_events (Moat #1).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — quote_save_workflow_events', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let jobIdA: string;
  let jobIdB: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    jobIdA = uuidv7();
    jobIdB = uuidv7();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, `qswe-rls-a-${Date.now()}`, 'A', tenantB, `qswe-rls-b-${Date.now()}`, 'B'],
      );
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, status, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, $3, 'new', 'tow', '1 Test', 'customer'),
                ($4, $5, $6, 'new', 'tow', '1 Test', 'customer')`,
        [jobIdA, tenantA, `${day}-9101`, jobIdB, tenantB, `${day}-9102`],
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
        await c.query('DELETE FROM quote_save_workflow_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM jobs WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  it('without context: SELECT 0 rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const res = await c.query('SELECT count(*)::int AS n FROM quote_save_workflow_events');
      expect(res.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('A inserts; only A sees', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO quote_save_workflow_events (id, tenant_id, job_id, step, accepted)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'save_step_1', false)`,
        [uuidv7(), tenantA, jobIdA],
      );
      const r = await c.query('SELECT tenant_id FROM quote_save_workflow_events');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("A cannot see B's events", async () => {
    const ac = await admin.connect();
    try {
      await ac.query(
        `INSERT INTO quote_save_workflow_events (id, tenant_id, job_id, step, accepted)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'save_step_2', true)`,
        [uuidv7(), tenantB, jobIdB],
      );
    } finally {
      ac.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM quote_save_workflow_events',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("UPDATE B's row from A context = 0 rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query(
        'UPDATE quote_save_workflow_events SET accepted = false WHERE tenant_id = $1',
        [tenantB],
      );
      expect(res.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('foreign tenant_id INSERT rejected', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO quote_save_workflow_events (id, tenant_id, job_id, step, accepted)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'save_step_1', false)`,
          [uuidv7(), tenantB, jobIdB],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('illegal step value rejected by CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO quote_save_workflow_events (id, tenant_id, job_id, step, accepted)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'save_step_999', false)`,
          [uuidv7(), tenantA, jobIdA],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
