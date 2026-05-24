/**
 * RLS tenant-isolation + cross-tenant FK consistency for the Full DOT
 * Compliance tables (Session 37). DB-gated: self-skips without Postgres
 * (mirrors impound-rls.spec.ts).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — DOT compliance', () => {
  let admin: Pool;
  let app: Pool;
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const driverA = uuidv7();
  const driverB = uuidv7();
  const slugA = `dot-rls-a-${Date.now()}`;
  const slugB = `dot-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`,
        [tenantA, slugA, 'DOT RLS A', tenantB, slugB, 'DOT RLS B'],
      );
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name)
         VALUES ($1,$2,'Ann','A'),($3,$4,'Bob','B')`,
        [driverA, tenantA, driverB, tenantB],
      );
      await c.query(
        `INSERT INTO dot_carrier_profile (id, tenant_id, legal_name)
         VALUES ($1,$2,'Carrier A'),($3,$4,'Carrier B')`,
        [uuidv7(), tenantA, uuidv7(), tenantB],
      );
      await c.query(
        `INSERT INTO dot_driver_qualifications (id, tenant_id, driver_id)
         VALUES ($1,$2,$3),($4,$5,$6)`,
        [uuidv7(), tenantA, driverA, uuidv7(), tenantB, driverB],
      );
      await c.query(
        `INSERT INTO dot_hos_logs (id, tenant_id, driver_id, log_date, status, start_at)
         VALUES ($1,$2,$3,'2026-05-01','driving', now()),($4,$5,$6,'2026-05-01','driving', now())`,
        [uuidv7(), tenantA, driverA, uuidv7(), tenantB, driverB],
      );
      await c.query(
        `INSERT INTO dot_drug_alcohol_tests (id, tenant_id, driver_id, test_type, collected_at, result)
         VALUES ($1,$2,$3,'random', now(), 'negative'),($4,$5,$6,'random', now(), 'negative')`,
        [uuidv7(), tenantA, driverA, uuidv7(), tenantB, driverB],
      );
      await c.query(
        `INSERT INTO dot_incident_reports (id, tenant_id, occurred_at, severity)
         VALUES ($1,$2, now(), 'property_damage'),($3,$4, now(), 'property_damage')`,
        [uuidv7(), tenantA, uuidv7(), tenantB],
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
          'dot_incident_reports',
          'dot_drug_alcohol_tests',
          'dot_hos_logs',
          'dot_driver_qualifications',
          'dot_carrier_profile',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
        }
        await c.query('DELETE FROM drivers WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
        await c.query('DELETE FROM tenants WHERE id IN ($1,$2)', [tenantA, tenantB]);
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

  const tables = [
    'dot_carrier_profile',
    'dot_driver_qualifications',
    'dot_hos_logs',
    'dot_drug_alcohol_tests',
    'dot_incident_reports',
  ];

  for (const table of tables) {
    it(`${table}: tenant A sees only its own rows`, async () => {
      const c = await app.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
        const r = await c.query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id FROM ${table}`);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]?.tenant_id).toBe(tenantA);
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    });
  }

  it('rejects a cross-tenant driver_id on dot_hos_logs (consistency trigger)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [uuidv7()]);
      await expect(
        c.query(
          `INSERT INTO dot_hos_logs (id, tenant_id, driver_id, log_date, status, start_at)
           VALUES ($1,$2,$3,'2026-05-02','driving', now())`,
          [uuidv7(), tenantA, driverB], // driverB belongs to tenant B
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
