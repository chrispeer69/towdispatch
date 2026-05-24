/**
 * RLS isolation + cross-tenant FK guards for the Heavy-Duty Specialist
 * (Session 36) tables.
 *
 *   hd_truck_capabilities    — RLS + truck-tenant consistency trigger.
 *   hd_driver_certifications — RLS + driver-tenant consistency trigger +
 *                              the one-live-per-(driver,cert_type) index.
 *   hd_job_attributes        — RLS + job-tenant consistency trigger.
 *   hd_rate_sheets           — RLS + the (tenant, lower(name)) unique index.
 *
 * Self-skips when no database is configured (mirrors the other RLS specs).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — heavy-duty', () => {
  let admin: Pool;
  let app: Pool;
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const truckA = uuidv7();
  const truckB = uuidv7();
  const driverA = uuidv7();
  const driverB = uuidv7();
  const jobA = uuidv7();
  const jobB = uuidv7();
  const stamp = Date.now();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, `hd-rls-a-${stamp}`, 'HD RLS A', tenantB, `hd-rls-b-${stamp}`, 'HD RLS B'],
      );
      await c.query(
        `INSERT INTO trucks (id, tenant_id, unit_number)
         VALUES ($1, $2, 'HD-A'), ($3, $4, 'HD-B')`,
        [truckA, tenantA, truckB, tenantB],
      );
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name)
         VALUES ($1, $2, 'Ada', 'A'), ($3, $4, 'Ben', 'B')`,
        [driverA, tenantA, driverB, tenantB],
      );
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, $3, 'recovery', 'Scene A', 'police'),
                ($4, $5, $6, 'recovery', 'Scene B', 'police')`,
        [jobA, tenantA, `JOBA-${stamp}`, jobB, tenantB, `JOBB-${stamp}`],
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
        for (const t of [
          'hd_job_attributes',
          'hd_driver_certifications',
          'hd_truck_capabilities',
          'hd_rate_sheets',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
        }
        await c.query('DELETE FROM jobs WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM drivers WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM trucks WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  async function asTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // ---------------- hd_truck_capabilities ----------------

  it('hd_truck_capabilities: A sees only its own row', async () => {
    await asTenant(tenantA, (c) =>
      c.query(
        'INSERT INTO hd_truck_capabilities (id, tenant_id, truck_id, gvwr_class) VALUES ($1, $2, $3, 8)',
        [uuidv7(), tenantA, truckA],
      ),
    );
    await asTenant(tenantB, (c) =>
      c.query(
        'INSERT INTO hd_truck_capabilities (id, tenant_id, truck_id, gvwr_class) VALUES ($1, $2, $3, 7)',
        [uuidv7(), tenantB, truckB],
      ),
    );
    const rows = await asTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM hd_truck_capabilities'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantA);
  });

  it('hd_truck_capabilities: foreign truck_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query('INSERT INTO hd_truck_capabilities (id, tenant_id, truck_id) VALUES ($1, $2, $3)', [
          uuidv7(),
          tenantA,
          truckB,
        ]),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('hd_truck_capabilities: INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query('INSERT INTO hd_truck_capabilities (id, tenant_id, truck_id) VALUES ($1, $2, $3)', [
          uuidv7(),
          tenantB,
          truckB,
        ]),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('hd_truck_capabilities: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM hd_truck_capabilities');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // ---------------- hd_driver_certifications ----------------

  it('hd_driver_certifications: foreign driver_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO hd_driver_certifications (id, tenant_id, driver_id, cert_type) VALUES ($1, $2, $3, 'hd_operator')`,
          [uuidv7(), tenantA, driverB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('hd_driver_certifications: a second live cert of the same type for one driver is blocked', async () => {
    await asTenant(tenantA, (c) =>
      c.query(
        `INSERT INTO hd_driver_certifications (id, tenant_id, driver_id, cert_type) VALUES ($1, $2, $3, 'rotator')`,
        [uuidv7(), tenantA, driverA],
      ),
    );
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO hd_driver_certifications (id, tenant_id, driver_id, cert_type) VALUES ($1, $2, $3, 'rotator')`,
          [uuidv7(), tenantA, driverA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ---------------- hd_job_attributes ----------------

  it('hd_job_attributes: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query('INSERT INTO hd_job_attributes (id, tenant_id, job_id) VALUES ($1, $2, $3)', [
          uuidv7(),
          tenantA,
          jobB,
        ]),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ---------------- hd_rate_sheets ----------------

  it('hd_rate_sheets: isolation + duplicate (tenant, name) is blocked', async () => {
    await asTenant(tenantA, (c) =>
      c.query(`INSERT INTO hd_rate_sheets (id, tenant_id, name) VALUES ($1, $2, 'Standard HD')`, [
        uuidv7(),
        tenantA,
      ]),
    );
    const onlyA = await asTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM hd_rate_sheets'),
    );
    expect(onlyA.rows).toHaveLength(1);
    expect(onlyA.rows[0]?.tenant_id).toBe(tenantA);

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(`INSERT INTO hd_rate_sheets (id, tenant_id, name) VALUES ($1, $2, 'standard hd')`, [
          uuidv7(),
          tenantA,
        ]),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
