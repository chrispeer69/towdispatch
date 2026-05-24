/**
 * RLS isolation for the Repo Compliance (Session 50) tenant tables.
 *
 *   repo_required_notices  — RLS + the pending-notice partial-unique
 *                            idempotency index.
 *   repo_timeline_events   — RLS tenant isolation.
 *
 * There is no parent repo_cases table yet (S49 deferral — see
 * SESSION_50_DECISIONS.md D0), so repo_case_id is a free uuid and there is no
 * cross-tenant parent-consistency trigger to exercise (that lands with S49).
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

describeIfDb('RLS tenant isolation — repo compliance', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let caseA: string;
  let caseB: string;
  const slugA = `repo-rls-a-${Date.now()}`;
  const slugB = `repo-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
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
        `INSERT INTO repo_required_notices
           (id, tenant_id, repo_case_id, state, notice_type, recipient_role, statute_citation, delivery_method)
         VALUES ($1, $2, $3, 'CA', 'post_repo_notice', 'debtor', 'CA Civil Code 2983.2', 'certified'),
                ($4, $5, $6, 'TX', 'post_repo_notice', 'debtor', 'TX Bus. & Com. Code 9.609', 'certified')`,
        [uuidv7(), tenantA, caseA, uuidv7(), tenantB, caseB],
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
        await c.query('DELETE FROM repo_timeline_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM repo_required_notices WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
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

  // ------------------- repo_required_notices -------------------

  it('repo_required_notices: tenant A sees only its own notice', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM repo_required_notices',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('repo_required_notices: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        "UPDATE repo_required_notices SET notes = 'pwned' WHERE repo_case_id = $1::uuid",
        [caseB],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('repo_required_notices: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO repo_required_notices
             (id, tenant_id, repo_case_id, state, notice_type, recipient_role, statute_citation, delivery_method)
           VALUES ($1, $2, $3, 'CA', 'post_repo_notice', 'debtor', 'x', 'certified')`,
          [uuidv7(), tenantB, caseB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('repo_required_notices: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM repo_required_notices');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('repo_required_notices: a second pending notice of the same (case, type, role) is blocked', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      // caseA already has a pending post_repo_notice to the debtor (seeded).
      await expect(
        c.query(
          `INSERT INTO repo_required_notices
             (id, tenant_id, repo_case_id, state, notice_type, recipient_role, statute_citation, delivery_method)
           VALUES ($1, $2, $3, 'CA', 'post_repo_notice', 'debtor', 'x', 'email')`,
          [uuidv7(), tenantA, caseA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------- repo_timeline_events -------------------

  it('repo_timeline_events: a B event is invisible to A', async () => {
    const c = await app.connect();
    try {
      const ac = await admin.connect();
      try {
        await ac.query(
          `INSERT INTO repo_timeline_events (id, tenant_id, repo_case_id, event_type)
           VALUES ($1, $2, $3, 'notice_recorded')`,
          [uuidv7(), tenantB, caseB],
        );
      } finally {
        ac.release();
      }
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM repo_timeline_events',
      );
      expect(r.rows.every((row) => row.tenant_id === tenantA)).toBe(true);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('repo_timeline_events: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO repo_timeline_events (id, tenant_id, repo_case_id, event_type)
           VALUES ($1, $2, $3, 'notice_recorded')`,
          [uuidv7(), tenantB, caseB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
