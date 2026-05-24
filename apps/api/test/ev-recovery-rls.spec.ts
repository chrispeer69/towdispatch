/**
 * RLS isolation + cross-tenant FK guards for the EV Recovery (Session 48)
 * tables.
 *
 *   ev_job_attributes        — RLS + the job consistency trigger (the
 *                              referenced job's tenant must match the row) +
 *                              the one-row-per-job partial unique index.
 *   ev_thermal_events        — RLS + the job consistency trigger.
 *   ev_charge_station_visits — RLS + the job consistency trigger.
 *   ev_oem_procedures        — GLOBAL reference data: NO RLS; both tenants see
 *                              the same seeded rows. Confirmed below.
 *
 * Self-skips when no database is configured (mirrors lien-processing-rls.spec.ts).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

async function insertJob(
  c: import('pg').PoolClient,
  id: string,
  tenantId: string,
  num: string,
): Promise<void> {
  await c.query(
    `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
     VALUES ($1, $2, $3, 'tow', '1 Main St', 'customer')`,
    [id, tenantId, num],
  );
}

describeIfDb('RLS tenant isolation — ev recovery', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let jobA: string;
  let jobB: string;
  let attrA: string;
  const slugA = `ev-rls-a-${Date.now()}`;
  const slugB = `ev-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    jobA = uuidv7();
    jobB = uuidv7();
    attrA = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'EV RLS A', tenantB, slugB, 'EV RLS B'],
      );
      await insertJob(c, jobA, tenantA, `EVA-${Date.now()}`);
      await insertJob(c, jobB, tenantB, `EVB-${Date.now()}`);
      await c.query(
        `INSERT INTO ev_job_attributes (id, tenant_id, job_id, make, model)
         VALUES ($1, $2, $3, 'Tesla', 'Model 3')`,
        [attrA, tenantA, jobA],
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
        await c.query('DELETE FROM ev_thermal_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM ev_charge_station_visits WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM ev_job_attributes WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM jobs WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  // ------------------------- ev_job_attributes -------------------------

  it('ev_job_attributes: tenant A sees only its own row', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM ev_job_attributes',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('ev_job_attributes: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM ev_job_attributes');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('ev_job_attributes: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO ev_job_attributes (id, tenant_id, job_id)
           VALUES ($1, $2, $3)`,
          [uuidv7(), tenantB, jobB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('ev_job_attributes: a foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO ev_job_attributes (id, tenant_id, job_id)
           VALUES ($1, $2, $3)`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('ev_job_attributes: a second live row for the same job is blocked by the unique index', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO ev_job_attributes (id, tenant_id, job_id)
           VALUES ($1, $2, $3)`,
          [uuidv7(), tenantA, jobA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- ev_thermal_events -------------------------

  it('ev_thermal_events: a foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO ev_thermal_events (id, tenant_id, job_id, severity)
           VALUES ($1, $2, $3, 'smoke')`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('ev_thermal_events: a row on A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO ev_thermal_events (id, tenant_id, job_id, severity)
         VALUES ($1, $2, $3, 'venting')`,
        [uuidv7(), tenantA, jobA],
      );
      const r = await c.query('SELECT id FROM ev_thermal_events');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  // ------------------------- ev_charge_station_visits -------------------------

  it('ev_charge_station_visits: a foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO ev_charge_station_visits (id, tenant_id, job_id)
           VALUES ($1, $2, $3)`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- ev_oem_procedures (global ref) -------------------------

  it('ev_oem_procedures: GLOBAL reference data — visible to both tenants identically', async () => {
    const cA = await app.connect();
    const cB = await app.connect();
    try {
      await cA.query('BEGIN');
      await cA.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const rA = await cA.query<{ n: string }>('SELECT count(*)::text AS n FROM ev_oem_procedures');
      await cA.query('COMMIT');

      await cB.query('BEGIN');
      await cB.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      const rB = await cB.query<{ n: string }>('SELECT count(*)::text AS n FROM ev_oem_procedures');
      await cB.query('COMMIT');

      // Both tenants see the same seeded set (15+), proving no RLS partition.
      expect(rA.rows[0]?.n).toBe(rB.rows[0]?.n);
      expect(Number(rA.rows[0]?.n)).toBeGreaterThanOrEqual(15);
    } finally {
      cA.release();
      cB.release();
    }
  });

  it('ev_oem_procedures: even with NO GUC the reference rows are readable (no RLS)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query("SELECT id FROM ev_oem_procedures WHERE make = 'Tesla' LIMIT 1");
      expect(r.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      c.release();
    }
  });
});
