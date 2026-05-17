/**
 * RLS isolation + cross-tenant integrity for dynamic_pricing_overrides
 * (Moat #1).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — dynamic_pricing_overrides', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let jobIdA: string;
  let jobIdB: string;
  const slugA = `dpo-rls-a-${Date.now()}`;
  const slugB = `dpo-rls-b-${Date.now()}`;

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
        [tenantA, slugA, 'DPO RLS A', tenantB, slugB, 'DPO RLS B'],
      );
      // Minimal jobs rows with day-keyed job_number so the format check passes.
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, status, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, $3, 'new', 'tow', '1 Test St', 'customer'),
                ($4, $5, $6, 'new', 'tow', '1 Test St', 'customer')`,
        [jobIdA, tenantA, `${day}-9001`, jobIdB, tenantB, `${day}-9002`],
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
        await c.query('DELETE FROM dynamic_pricing_overrides WHERE tenant_id IN ($1, $2)', [
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

  it('without context: SELECT returns 0 rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const res = await c.query('SELECT count(*)::int AS n FROM dynamic_pricing_overrides');
      expect(res.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('insert under A; visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO dynamic_pricing_overrides
           (id, tenant_id, job_id, original_price_cents, override_price_cents, reason_code)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 12000, 9000, 'goodwill')`,
        [uuidv7(), tenantA, jobIdA],
      );
      const r = await c.query('SELECT tenant_id FROM dynamic_pricing_overrides');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("A cannot see B's overrides", async () => {
    const ac = await admin.connect();
    try {
      await ac.query(
        `INSERT INTO dynamic_pricing_overrides
           (id, tenant_id, job_id, original_price_cents, override_price_cents, reason_code)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 15000, 8000, 'price_match')`,
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
        'SELECT DISTINCT tenant_id FROM dynamic_pricing_overrides',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('cross-tenant job_id rejected by consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dynamic_pricing_overrides
             (id, tenant_id, job_id, original_price_cents, override_price_cents, reason_code)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 15000, 8000, 'goodwill')`,
          [uuidv7(), tenantA, jobIdB],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it("UPDATE B's override from A context affects zero rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query(
        `UPDATE dynamic_pricing_overrides SET note = 'attempted' WHERE tenant_id = $1`,
        [tenantB],
      );
      expect(res.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('INSERT with foreign tenant_id rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dynamic_pricing_overrides
             (id, tenant_id, job_id, original_price_cents, override_price_cents, reason_code)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 15000, 8000, 'goodwill')`,
          [uuidv7(), tenantB, jobIdB],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('other_with_note CHECK requires non-empty note', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dynamic_pricing_overrides
             (id, tenant_id, job_id, original_price_cents, override_price_cents, reason_code, note)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 12000, 9000, 'other_with_note', NULL)`,
          [uuidv7(), tenantA, jobIdA],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
