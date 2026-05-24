/**
 * RLS isolation + cross-tenant FK guards for the Repossession Workflow
 * (Session 49) tables.
 *
 *   lienholders            — standard tenant-scoped FORCE RLS table.
 *   repo_cases             — RLS + the case consistency trigger (lienholder_id's
 *                            tenant must match) + the partial-unique
 *                            idempotency index on (tenant, lienholder, number).
 *   repo_location_attempts — RLS + the child consistency trigger (case's
 *                            tenant must match).
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

describeIfDb('RLS tenant isolation — repo workflow', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let lienholderA: string;
  let lienholderB: string;
  let caseA: string;
  let caseB: string;
  const slugA = `repo-rls-a-${Date.now()}`;
  const slugB = `repo-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    lienholderA = uuidv7();
    lienholderB = uuidv7();
    caseA = uuidv7();
    caseB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'REPO RLS A', tenantB, slugB, 'REPO RLS B'],
      );
      await c.query(
        `INSERT INTO lienholders (id, tenant_id, name)
         VALUES ($1, $2, 'Bank A'), ($3, $4, 'Bank B')`,
        [lienholderA, tenantA, lienholderB, tenantB],
      );
      await c.query(
        `INSERT INTO repo_cases (id, tenant_id, lienholder_id, case_number)
         VALUES ($1, $2, $3, 'CASE-1'), ($4, $5, $6, 'CASE-1')`,
        [caseA, tenantA, lienholderA, caseB, tenantB, lienholderB],
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
        // FK order: children → cases → lienholders → tenants
        for (const t of [
          'repo_condition_photos',
          'repo_personal_property',
          'repo_recovery_events',
          'repo_location_attempts',
          'repo_cases',
          'lienholders',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
        }
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

  // ------------------------- lienholders -------------------------

  it('lienholders: tenant A sees only its own', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM lienholders');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('lienholders: INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(`INSERT INTO lienholders (id, tenant_id, name) VALUES ($1, $2, 'X')`, [
          uuidv7(),
          tenantB,
        ]),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('lienholders: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM lienholders');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // ------------------------- repo_cases -------------------------

  it('repo_cases: tenant A cannot see B', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM repo_cases');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('repo_cases: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query("UPDATE repo_cases SET notes = 'pwned' WHERE id = $1::uuid", [
        caseB,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('repo_cases: foreign lienholder_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO repo_cases (id, tenant_id, lienholder_id, case_number)
           VALUES ($1, $2, $3, 'X-1')`,
          [uuidv7(), tenantA, lienholderB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('repo_cases: a second active case with the same number is blocked by the partial unique index', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO repo_cases (id, tenant_id, lienholder_id, case_number)
           VALUES ($1, $2, $3, 'CASE-1')`,
          [uuidv7(), tenantA, lienholderA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('repo_cases: a cancelled case frees its number for re-use', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      // Cancel the seed case, then a new active case with the same number is allowed.
      await c.query("UPDATE repo_cases SET status = 'cancelled' WHERE id = $1::uuid", [caseA]);
      const ins = await c.query(
        `INSERT INTO repo_cases (id, tenant_id, lienholder_id, case_number)
         VALUES ($1, $2, $3, 'CASE-1') RETURNING id`,
        [uuidv7(), tenantA, lienholderA],
      );
      expect(ins.rowCount).toBe(1);
      await c.query('ROLLBACK'); // don't persist — keep seed state for other tests
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- repo_location_attempts -------------------------

  it('repo_location_attempts: foreign repo_case_id (B) under A is rejected by the child consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO repo_location_attempts (id, tenant_id, repo_case_id, outcome)
           VALUES ($1, $2, $3, 'not_home')`,
          [uuidv7(), tenantA, caseB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('repo_location_attempts: a child on A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO repo_location_attempts (id, tenant_id, repo_case_id, outcome)
         VALUES ($1, $2, $3, 'not_home')`,
        [uuidv7(), tenantA, caseA],
      );
      const r = await c.query('SELECT id FROM repo_location_attempts');
      expect(r.rows).toHaveLength(1);
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
