/**
 * RLS isolation + cross-tenant FK guards for the Photo Damage Analysis
 * (Session 42) tables.
 *
 *   damage_analyses    — RLS + the analyses consistency trigger (job_id's
 *                        tenant must match the row's tenant).
 *   damage_findings    — RLS + the child consistency trigger (analysis's
 *                        tenant must match).
 *   damage_comparisons — RLS + the (job, pre, post) triple-unique index.
 *
 * Self-skips when no database is configured (mirrors the other RLS specs).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — photo damage analysis', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let jobA: string;
  let jobB: string;
  let analysisA: string;
  let analysisB: string;
  const slugA = `dmg-rls-a-${Date.now()}`;
  const slugB = `dmg-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    jobA = uuidv7();
    jobB = uuidv7();
    analysisA = uuidv7();
    analysisB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'DMG RLS A', tenantB, slugB, 'DMG RLS B'],
      );
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, 'D-A-1', 'tow', '1 A St', 'customer'),
                ($3, $4, 'D-B-1', 'tow', '1 B St', 'customer')`,
        [jobA, tenantA, jobB, tenantB],
      );
      await c.query(
        `INSERT INTO damage_analyses (id, tenant_id, job_id, phase, provider, status)
         VALUES ($1, $2, $3, 'pre_tow', 'stub', 'complete'),
                ($4, $5, $6, 'pre_tow', 'stub', 'complete')`,
        [analysisA, tenantA, jobA, analysisB, tenantB, jobB],
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
        await c.query('DELETE FROM damage_comparisons WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM damage_findings WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM damage_analyses WHERE tenant_id IN ($1, $2)', [
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

  // ----------------------- damage_analyses -----------------------

  it('damage_analyses: tenant A sees only its own', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM damage_analyses',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('damage_analyses: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM damage_analyses');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('damage_analyses: INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO damage_analyses (id, tenant_id, job_id, phase, provider, status)
           VALUES ($1, $2, $3, 'pre_tow', 'stub', 'queued')`,
          [uuidv7(), tenantB, jobB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('damage_analyses: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO damage_analyses (id, tenant_id, job_id, phase, provider, status)
           VALUES ($1, $2, $3, 'pre_tow', 'stub', 'queued')`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ----------------------- damage_findings -----------------------

  it('damage_findings: a finding on A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO damage_findings (id, tenant_id, analysis_id, area, severity, confidence_pct)
         VALUES ($1, $2, $3, 'hood', 'minor', 90)`,
        [uuidv7(), tenantA, analysisA],
      );
      const r = await c.query('SELECT id FROM damage_findings');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('damage_findings: foreign analysis_id (B) under A is rejected by the child consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO damage_findings (id, tenant_id, analysis_id, area, severity, confidence_pct)
           VALUES ($1, $2, $3, 'hood', 'minor', 90)`,
          [uuidv7(), tenantA, analysisB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // --------------------- damage_comparisons ---------------------

  it('damage_comparisons: a second comparison for the same (job, pre, post) triple is blocked', async () => {
    // Need a distinct second analysis on A to form a valid pre/post pair.
    const analysisA2 = uuidv7();
    const setup = await admin.connect();
    try {
      await setup.query(
        `INSERT INTO damage_analyses (id, tenant_id, job_id, phase, provider, status)
         VALUES ($1, $2, $3, 'post_tow', 'stub', 'complete')`,
        [analysisA2, tenantA, jobA],
      );
    } finally {
      setup.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO damage_comparisons (id, tenant_id, job_id, pre_analysis_id, post_analysis_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv7(), tenantA, jobA, analysisA, analysisA2],
      );
      await expect(
        c.query(
          `INSERT INTO damage_comparisons (id, tenant_id, job_id, pre_analysis_id, post_analysis_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), tenantA, jobA, analysisA, analysisA2],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('damage_comparisons: pre == post is rejected by CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO damage_comparisons (id, tenant_id, job_id, pre_analysis_id, post_analysis_id)
           VALUES ($1, $2, $3, $4, $4)`,
          [uuidv7(), tenantA, jobA, analysisA],
        ),
      ).rejects.toThrowError(/damage_comparisons_distinct_analyses|check/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
