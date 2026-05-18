/**
 * RLS isolation for Driver Experience (Session 1) tables.
 *
 * Covers three of the eight new tables — chosen to exercise every
 * pattern the migration introduces:
 *
 *   1) driver_pretrip_inspections — standard tenant-scoped table with
 *      an audit trigger. Proves the FORCE RLS policy + WITH CHECK
 *      rejection + cross-tenant UPDATE invisibility.
 *
 *   2) driver_telemetry_events — the explicitly-NO-audit hot path
 *      table. Verifies RLS isolation still works on the high-volume
 *      append-only table even though the audit trigger is omitted.
 *
 *   3) job_evidence — proves the cross-tenant consistency BEFORE
 *      INSERT/UPDATE trigger (`fn_job_evidence_tenant_consistency`)
 *      rejects an attempt to attach evidence to a foreign tenant's
 *      job, *in addition* to RLS.
 *
 * The remaining five tables (driver_pins, driver_daily_briefings,
 * driver_briefing_acknowledgments, job_field_payments,
 * driver_offline_actions) follow the exact same policy template and
 * are exercised implicitly by the same patterns.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — driver experience', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let driverIdA: string;
  let driverIdB: string;
  let truckIdA: string;
  let truckIdB: string;
  let jobIdA: string;
  let jobIdB: string;
  const slugA = `dx-rls-a-${Date.now()}`;
  const slugB = `dx-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    driverIdA = uuidv7();
    driverIdB = uuidv7();
    truckIdA = uuidv7();
    truckIdB = uuidv7();
    jobIdA = uuidv7();
    jobIdB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'DX RLS A', tenantB, slugB, 'DX RLS B'],
      );
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
         VALUES ($1::uuid, $2::uuid, 'DX', 'DriverA', 'none', true),
                ($3::uuid, $4::uuid, 'DX', 'DriverB', 'none', true)`,
        [driverIdA, tenantA, driverIdB, tenantB],
      );
      await c.query(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, in_service)
         VALUES ($1::uuid, $2::uuid, $3, 'light_duty', true),
                ($4::uuid, $5::uuid, $6, 'light_duty', true)`,
        [truckIdA, tenantA, `T-A-${Date.now()}`, truckIdB, tenantB, `T-B-${Date.now()}`],
      );
      // job_number must match ^[0-9]{8}-[0-9]{4,}$ (jobs_job_number_format).
      // Date-derived suffix keeps two parallel test runs from colliding.
      const suffix = Date.now().toString().slice(-6);
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, status, service_type, pickup_address, authorized_by)
         VALUES ($1::uuid, $2::uuid, $3, 'new', 'tow', '1 DX RLS', 'customer'),
                ($4::uuid, $5::uuid, $6, 'new', 'tow', '2 DX RLS', 'customer')`,
        [jobIdA, tenantA, `20990101-1${suffix}`, jobIdB, tenantB, `20990101-2${suffix}`],
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
        // Delete in FK order: driver-experience rows first, then their parents.
        await c.query('DELETE FROM job_field_payments WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM job_evidence WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM driver_offline_actions WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM driver_telemetry_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM driver_pretrip_inspections WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM driver_briefing_acknowledgments WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM driver_daily_briefings WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM driver_pins WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM jobs WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM trucks WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM drivers WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  // -------------------------------------------------------------------------
  // 1) driver_pretrip_inspections
  // -------------------------------------------------------------------------

  it('driver_pretrip_inspections: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO driver_pretrip_inspections
           (id, tenant_id, driver_id, truck_id, status, items, odometer_miles)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'pass', '[]'::jsonb, 12345)`,
        [uuidv7(), tenantA, driverIdA, truckIdA],
      );
      const r = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM driver_pretrip_inspections',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("driver_pretrip_inspections: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO driver_pretrip_inspections
           (id, tenant_id, driver_id, truck_id, status, items, odometer_miles)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'fail_unsafe', '[]'::jsonb, 99999)`,
        [uuidv7(), tenantB, driverIdB, truckIdB],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM driver_pretrip_inspections',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("driver_pretrip_inspections: UPDATE on tenant B's row from A's context affects zero rows", async () => {
    const adminC = await admin.connect();
    let bRowId = '';
    try {
      const r = await adminC.query<{ id: string }>(
        'SELECT id FROM driver_pretrip_inspections WHERE tenant_id = $1 LIMIT 1',
        [tenantB],
      );
      bRowId = r.rows[0]?.id as string;
      expect(bRowId).toBeTruthy();
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        "UPDATE driver_pretrip_inspections SET notes = 'pwned' WHERE id = $1::uuid",
        [bRowId],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('driver_pretrip_inspections: INSERT with foreign tenant_id from A is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO driver_pretrip_inspections
             (id, tenant_id, driver_id, truck_id, status, items)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'pass', '[]'::jsonb)`,
          [uuidv7(), tenantB, driverIdB, truckIdB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('driver_pretrip_inspections: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT id FROM driver_pretrip_inspections');
      expect(r.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  // -------------------------------------------------------------------------
  // 2) driver_telemetry_events (no audit trigger — RLS must still hold)
  // -------------------------------------------------------------------------

  it('driver_telemetry_events: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO driver_telemetry_events
           (id, tenant_id, driver_id, recorded_at, lat, lng, event_kind)
         VALUES ($1::uuid, $2::uuid, $3::uuid, now(), 40.7128, -74.0060, 'ping')`,
        [uuidv7(), tenantA, driverIdA],
      );
      const r = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM driver_telemetry_events',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("driver_telemetry_events: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO driver_telemetry_events
           (id, tenant_id, driver_id, recorded_at, lat, lng, event_kind)
         VALUES ($1::uuid, $2::uuid, $3::uuid, now(), 34.0522, -118.2437, 'ping')`,
        [uuidv7(), tenantB, driverIdB],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM driver_telemetry_events',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('driver_telemetry_events: INSERT with foreign tenant_id from A is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO driver_telemetry_events
             (id, tenant_id, driver_id, recorded_at, event_kind)
           VALUES ($1::uuid, $2::uuid, $3::uuid, now(), 'ping')`,
          [uuidv7(), tenantB, driverIdB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('driver_telemetry_events: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM driver_telemetry_events');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // -------------------------------------------------------------------------
  // 3) job_evidence (cross-tenant trigger + RLS)
  // -------------------------------------------------------------------------

  it('job_evidence: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO job_evidence
           (id, tenant_id, job_id, driver_id, kind, s3_key, content_type, size_bytes, upload_status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'photo_pickup', $5, 'image/jpeg', 102400, 'pending')`,
        [uuidv7(), tenantA, jobIdA, driverIdA, `evidence/${tenantA}/photo-a-${Date.now()}.jpg`],
      );
      const r = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM job_evidence');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("job_evidence: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO job_evidence
           (id, tenant_id, job_id, driver_id, kind, s3_key, upload_status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'photo_dropoff', $5, 'uploaded')`,
        [uuidv7(), tenantB, jobIdB, driverIdB, `evidence/${tenantB}/photo-b-${Date.now()}.jpg`],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM job_evidence');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('job_evidence: cross-tenant FK injection is rejected by the consistency trigger', async () => {
    // Tenant A's GUC, but supply tenant B's jobId. The BEFORE trigger
    // looks up jobs.tenant_id and must reject. RLS makes the foreign job
    // invisible to the trigger's SELECT, so the rejection message is
    // either "does not exist" or "does not match" — both block the write.
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO job_evidence
             (id, tenant_id, job_id, driver_id, kind, s3_key, upload_status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'photo_other', $5, 'pending')`,
          [
            uuidv7(),
            tenantA,
            jobIdB,
            driverIdA,
            `evidence/${tenantA}/cross-tenant-${Date.now()}.jpg`,
          ],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('job_evidence: INSERT with foreign tenant_id from A is rejected (RLS or trigger)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO job_evidence
             (id, tenant_id, job_id, driver_id, kind, s3_key, upload_status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'photo_other', $5, 'pending')`,
          [uuidv7(), tenantB, jobIdB, driverIdB, `evidence/${tenantB}/inject-${Date.now()}.jpg`],
        ),
        // The BEFORE trigger evaluates first and can short-circuit on
        // "does not exist" (RLS hides B's job from the trigger's SELECT)
        // OR RLS WITH CHECK fires on the foreign tenant_id. Either path
        // is a valid block.
      ).rejects.toThrowError(/row-level security|policy|does not exist|does not match/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('job_evidence: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM job_evidence');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });
});
