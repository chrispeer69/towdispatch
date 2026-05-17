/**
 * RLS isolation for dynamic_pricing_pulse_daily (Moat #1).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — dynamic_pricing_pulse_daily', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, `dppd-rls-a-${Date.now()}`, 'A', tenantB, `dppd-rls-b-${Date.now()}`, 'B'],
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
        await c.query('DELETE FROM dynamic_pricing_pulse_daily WHERE tenant_id IN ($1, $2)', [
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

  it('without context: SELECT 0 rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT count(*)::int AS n FROM dynamic_pricing_pulse_daily');
      expect(r.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('A inserts daily row; only A sees', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        'INSERT INTO dynamic_pricing_pulse_daily (tenant_id, pulse_date, revenue_cents) VALUES ($1, $2, 50000)',
        [tenantA, today],
      );
      const r = await c.query('SELECT tenant_id FROM dynamic_pricing_pulse_daily');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("A cannot see B's pulse rows", async () => {
    const ac = await admin.connect();
    try {
      await ac.query(
        'INSERT INTO dynamic_pricing_pulse_daily (tenant_id, pulse_date, revenue_cents) VALUES ($1, $2, 90000)',
        [tenantB, today],
      );
    } finally {
      ac.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM dynamic_pricing_pulse_daily',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('UPDATE foreign row affects 0 rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query(
        'UPDATE dynamic_pricing_pulse_daily SET revenue_cents = 1 WHERE tenant_id = $1',
        [tenantB],
      );
      expect(r.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('DELETE foreign row affects 0 rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query('DELETE FROM dynamic_pricing_pulse_daily WHERE tenant_id = $1', [
        tenantB,
      ]);
      expect(r.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('PK uniqueness: same (tenant, date) cannot duplicate without ON CONFLICT', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          'INSERT INTO dynamic_pricing_pulse_daily (tenant_id, pulse_date, revenue_cents) VALUES ($1, $2, 1)',
          [tenantA, today],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
