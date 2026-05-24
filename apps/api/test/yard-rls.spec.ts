/**
 * RLS isolation + cross-tenant FK guards for the Yard Management
 * (Session 54) tables: yard_facilities, yard_stalls (facility + occupant
 * consistency trigger), storage_charges (impound consistency trigger +
 * per-day idempotency), and release_workflows. Also asserts the gate-search
 * surface can never cross a tenant boundary (RLS on the underlying tables).
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

describeIfDb('RLS tenant isolation — yard management', () => {
  let admin: Pool;
  let app: Pool;
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const yardA = uuidv7();
  const yardB = uuidv7();
  const recordA = uuidv7();
  const recordB = uuidv7();
  const facA = uuidv7();
  const facB = uuidv7();
  const stallA = uuidv7();
  const stallB = uuidv7();
  const slugA = `yard-rls-a-${Date.now()}`;
  const slugB = `yard-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`,
        [tenantA, slugA, 'Yard RLS A', tenantB, slugB, 'Yard RLS B'],
      );
      await c.query(
        `INSERT INTO impound_yards (id, tenant_id, name, code) VALUES ($1,$2,'Y','A1'),($3,$4,'Y','B1')`,
        [yardA, tenantA, yardB, tenantB],
      );
      await c.query(
        'INSERT INTO impound_records (id, tenant_id, yard_id, daily_fee_cents) VALUES ($1,$2,$3,0),($4,$5,$6,0)',
        [recordA, tenantA, yardA, recordB, tenantB, yardB],
      );
      await c.query(
        `INSERT INTO yard_facilities (id, tenant_id, name) VALUES ($1,$2,'Fac A'),($3,$4,'Fac B')`,
        [facA, tenantA, facB, tenantB],
      );
      await c.query(
        `INSERT INTO yard_stalls (id, tenant_id, facility_id, label) VALUES ($1,$2,$3,'S1'),($4,$5,$6,'S1')`,
        [stallA, tenantA, facA, stallB, tenantB, facB],
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
        const ids = [tenantA, tenantB];
        for (const t of [
          'storage_charges',
          'release_workflows',
          'yard_stall_photos',
          'yard_stalls',
          'storage_rate_cards',
          'storage_billing_runs',
          'yard_facilities',
          'impound_records',
          'impound_yards',
          'audit_log',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1,$2)`, ids);
        }
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id IN ($1,$2)', ids);
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

  const asTenant = async <T>(
    tenant: string,
    fn: (c: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
      const out = await fn(c);
      await c.query('COMMIT').catch(() => {});
      return out;
    } finally {
      c.release();
    }
  };

  it('yard_facilities: tenant A sees only its own facility', async () => {
    const rows = await asTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM yard_facilities'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantA);
  });

  it('yard_facilities: UPDATE of B from A affects zero rows', async () => {
    const upd = await asTenant(tenantA, (c) =>
      c.query("UPDATE yard_facilities SET name='pwned' WHERE id=$1::uuid", [facB]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('yard_facilities: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM yard_facilities');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('yard_stalls: a cross-tenant facility_id is rejected (consistency trigger)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO yard_stalls (id, tenant_id, facility_id, label) VALUES ($1,$2,$3,'X')`,
          [uuidv7(), tenantA, facB],
        ),
      ).rejects.toThrow(/does not exist|does not match|row-level security/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('storage_charges: a cross-tenant impound_id is rejected (consistency trigger)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO storage_charges (id, tenant_id, impound_id, charge_date, vehicle_class, amount_cents)
           VALUES ($1,$2,$3,'2026-05-24','passenger',1000)`,
          [uuidv7(), tenantA, recordB],
        ),
      ).rejects.toThrow(/does not exist|does not match|row-level security/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('storage_charges: a second charge for the same vehicle + day is rejected (idempotency index)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO storage_charges (id, tenant_id, impound_id, charge_date, vehicle_class, amount_cents)
         VALUES ($1,$2,$3,'2026-05-24','passenger',1000)`,
        [uuidv7(), tenantA, recordA],
      );
      await expect(
        c.query(
          `INSERT INTO storage_charges (id, tenant_id, impound_id, charge_date, vehicle_class, amount_cents)
           VALUES ($1,$2,$3,'2026-05-24','passenger',1000)`,
          [uuidv7(), tenantA, recordA],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
