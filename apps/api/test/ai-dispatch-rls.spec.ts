/**
 * RLS isolation + cross-tenant FK guards + a recommendation→outcome round-trip
 * for the AI Smart Dispatch (Session 41) tables.
 *
 *   dispatch_recommendations — RLS + job-tenant consistency trigger.
 *   dispatch_outcomes        — RLS + job-tenant consistency + one-live-per-job
 *                              index + the predicted/actual/error round-trip.
 *   eta_predictions          — RLS + job-tenant consistency + the time-of-day /
 *                              day-of-week CHECK constraints.
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

describeIfDb('RLS tenant isolation — ai-dispatch', () => {
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
        [tenantA, `aid-rls-a-${stamp}`, 'AID RLS A', tenantB, `aid-rls-b-${stamp}`, 'AID RLS B'],
      );
      await c.query(
        `INSERT INTO trucks (id, tenant_id, unit_number)
         VALUES ($1, $2, 'AID-A'), ($3, $4, 'AID-B')`,
        [truckA, tenantA, truckB, tenantB],
      );
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name)
         VALUES ($1, $2, 'Ada', 'A'), ($3, $4, 'Ben', 'B')`,
        [driverA, tenantA, driverB, tenantB],
      );
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, $3, 'tow', 'Scene A', 'customer'),
                ($4, $5, $6, 'tow', 'Scene B', 'customer')`,
        [jobA, tenantA, `AIDA-${stamp}`, jobB, tenantB, `AIDB-${stamp}`],
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
        for (const t of ['dispatch_outcomes', 'eta_predictions', 'dispatch_recommendations']) {
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

  // ---------------- dispatch_recommendations ----------------

  it('dispatch_recommendations: A sees only its own row', async () => {
    await asTenant(tenantA, (c) =>
      c.query(
        `INSERT INTO dispatch_recommendations (id, tenant_id, job_id, model_version, recommendations)
         VALUES ($1, $2, $3, 'ai-dispatch-scoring-v1', '[]'::jsonb)`,
        [uuidv7(), tenantA, jobA],
      ),
    );
    await asTenant(tenantB, (c) =>
      c.query(
        `INSERT INTO dispatch_recommendations (id, tenant_id, job_id, model_version, recommendations)
         VALUES ($1, $2, $3, 'ai-dispatch-scoring-v1', '[]'::jsonb)`,
        [uuidv7(), tenantB, jobB],
      ),
    );
    const rows = await asTenant(tenantA, (c) =>
      c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM dispatch_recommendations'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.tenant_id).toBe(tenantA);
  });

  it('dispatch_recommendations: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dispatch_recommendations (id, tenant_id, job_id, model_version) VALUES ($1, $2, $3, 'v1')`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('dispatch_recommendations: INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dispatch_recommendations (id, tenant_id, job_id, model_version) VALUES ($1, $2, $3, 'v1')`,
          [uuidv7(), tenantB, jobB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('dispatch_recommendations: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM dispatch_recommendations');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // ---------------- dispatch_outcomes (round-trip + guards) ----------------

  it('dispatch_outcomes: recommendation→outcome round-trip stores predicted/actual/error', async () => {
    const recId = uuidv7();
    const topItem = [
      {
        truckId: truckA,
        truckUnit: 'AID-A',
        driverId: driverA,
        driverName: 'Ada A',
        shiftId: null,
        score: 91.2,
        factors: [],
        predictedEtaMinutes: 10,
      },
    ];
    await asTenant(tenantA, (c) =>
      c.query(
        `INSERT INTO dispatch_recommendations (id, tenant_id, job_id, model_version, recommendations)
         VALUES ($1, $2, $3, 'ai-dispatch-scoring-v1', $4::jsonb)`,
        [recId, tenantA, jobA, JSON.stringify(topItem)],
      ),
    );

    // Dispatcher picked the #1; arrived 13 min vs 10 predicted → error +3.
    await asTenant(tenantA, (c) =>
      c.query(
        `INSERT INTO dispatch_outcomes
           (id, tenant_id, job_id, recommendation_id, chosen_truck_id, chosen_driver_id,
            was_top_recommendation, predicted_eta_minutes, actual_eta_minutes, eta_error_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, true, 10, 13, 3)`,
        [uuidv7(), tenantA, jobA, recId, truckA, driverA],
      ),
    );

    const r = await asTenant(tenantA, (c) =>
      c.query<{
        was_top_recommendation: boolean;
        eta_error_minutes: number;
        recommendation_id: string;
      }>(
        'SELECT was_top_recommendation, eta_error_minutes, recommendation_id FROM dispatch_outcomes WHERE job_id = $1',
        [jobA],
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.was_top_recommendation).toBe(true);
    expect(r.rows[0]?.eta_error_minutes).toBe(3);
    expect(r.rows[0]?.recommendation_id).toBe(recId);
  });

  it('dispatch_outcomes: a second live outcome for the same job is blocked', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dispatch_outcomes (id, tenant_id, job_id, chosen_truck_id, chosen_driver_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), tenantA, jobA, truckA, driverA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('dispatch_outcomes: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dispatch_outcomes (id, tenant_id, job_id, chosen_truck_id, chosen_driver_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), tenantA, jobB, truckA, driverA],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ---------------- eta_predictions ----------------

  it('eta_predictions: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO eta_predictions (id, tenant_id, job_id, time_of_day, day_of_week, predicted_minutes, model_version)
           VALUES ($1, $2, $3, 12, 3, 20, 'eta-heuristic-v1')`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('eta_predictions: an out-of-range time_of_day is rejected by the CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO eta_predictions (id, tenant_id, job_id, time_of_day, day_of_week, predicted_minutes, model_version)
           VALUES ($1, $2, $3, 24, 3, 20, 'eta-heuristic-v1')`,
          [uuidv7(), tenantA, jobA],
        ),
      ).rejects.toThrowError(/time_of_day|check/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('eta_predictions: a valid prediction round-trips under the owning tenant', async () => {
    await asTenant(tenantA, (c) =>
      c.query(
        `INSERT INTO eta_predictions (id, tenant_id, job_id, time_of_day, day_of_week, predicted_minutes, model_version)
         VALUES ($1, $2, $3, 17, 3, 28, 'eta-heuristic-v1')`,
        [uuidv7(), tenantA, jobA],
      ),
    );
    const r = await asTenant(tenantA, (c) =>
      c.query<{ predicted_minutes: number }>(
        'SELECT predicted_minutes FROM eta_predictions WHERE job_id = $1',
        [jobA],
      ),
    );
    expect(r.rows[0]?.predicted_minutes).toBe(28);
  });
});
