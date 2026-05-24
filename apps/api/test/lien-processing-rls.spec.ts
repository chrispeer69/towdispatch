/**
 * RLS isolation + cross-tenant FK guards for the Lien Processing (Session 23)
 * tables.
 *
 *   lien_cases            — RLS + the case consistency trigger (the
 *                           impound_record's tenant must match the row).
 *   lien_notices          — RLS + the child consistency trigger + the
 *                           pending-notice partial-unique idempotency index.
 *   lien_timeline_events  — RLS + the child consistency trigger.
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

describeIfDb('RLS tenant isolation — lien processing', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let recordA: string;
  let recordB: string;
  let caseA: string;
  let caseB: string;
  const slugA = `lien-rls-a-${Date.now()}`;
  const slugB = `lien-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    const yardA = uuidv7();
    const yardB = uuidv7();
    recordA = uuidv7();
    recordB = uuidv7();
    caseA = uuidv7();
    caseB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'LIEN RLS A', tenantB, slugB, 'LIEN RLS B'],
      );
      await c.query(
        `INSERT INTO impound_yards (id, tenant_id, name, code)
         VALUES ($1, $2, 'Yard A', 'A1'), ($3, $4, 'Yard B', 'B1')`,
        [yardA, tenantA, yardB, tenantB],
      );
      await c.query(
        `INSERT INTO impound_records (id, tenant_id, yard_id, daily_fee_cents)
         VALUES ($1, $2, $3, 3500), ($4, $5, $6, 3500)`,
        [recordA, tenantA, yardA, recordB, tenantB, yardB],
      );
      await c.query(
        `INSERT INTO lien_cases (id, tenant_id, impound_record_id, state)
         VALUES ($1, $2, $3, 'CA'), ($4, $5, $6, 'TX')`,
        [caseA, tenantA, recordA, caseB, tenantB, recordB],
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
        await c.query('DELETE FROM lien_timeline_events WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM lien_notices WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM lien_cases WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM impound_records WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM impound_yards WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  // ------------------------- lien_cases -------------------------

  it('lien_cases: tenant A sees only its own case', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM lien_cases');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('lien_cases: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query("UPDATE lien_cases SET notes = 'pwned' WHERE id = $1::uuid", [
        caseB,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('lien_cases: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO lien_cases (id, tenant_id, impound_record_id, state)
           VALUES ($1, $2, $3, 'CA')`,
          [uuidv7(), tenantB, recordB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('lien_cases: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM lien_cases');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('lien_cases: foreign impound_record_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO lien_cases (id, tenant_id, impound_record_id, state)
           VALUES ($1, $2, $3, 'CA')`,
          [uuidv7(), tenantA, recordB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- lien_notices -------------------------

  it('lien_notices: a notice on A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO lien_notices (id, tenant_id, lien_case_id, notice_type, recipient_role, delivery_method)
         VALUES ($1, $2, $3, 'owner_notice', 'owner', 'certified_mail')`,
        [uuidv7(), tenantA, caseA],
      );
      const r = await c.query('SELECT id FROM lien_notices');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('lien_notices: a second pending owner_notice for the same case is blocked by the unique index', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO lien_notices (id, tenant_id, lien_case_id, notice_type, recipient_role, delivery_method)
           VALUES ($1, $2, $3, 'owner_notice', 'owner', 'first_class_mail')`,
          [uuidv7(), tenantA, caseA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('lien_notices: foreign lien_case_id (B) under A is rejected by the child consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO lien_notices (id, tenant_id, lien_case_id, notice_type, recipient_role, delivery_method)
           VALUES ($1, $2, $3, 'owner_notice', 'owner', 'certified_mail')`,
          [uuidv7(), tenantA, caseB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- lien_timeline_events -------------------------

  it('lien_timeline_events: a B event is invisible to A', async () => {
    const c = await app.connect();
    try {
      // Seed an event for B as admin first.
      const ac = await admin.connect();
      try {
        await ac.query(
          `INSERT INTO lien_timeline_events (id, tenant_id, lien_case_id, event_type)
           VALUES ($1, $2, $3, 'case_opened')`,
          [uuidv7(), tenantB, caseB],
        );
      } finally {
        ac.release();
      }
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM lien_timeline_events',
      );
      expect(r.rows.every((row) => row.tenant_id === tenantA)).toBe(true);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('lien_timeline_events: foreign lien_case_id (B) under A is rejected by the child consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO lien_timeline_events (id, tenant_id, lien_case_id, event_type)
           VALUES ($1, $2, $3, 'case_opened')`,
          [uuidv7(), tenantA, caseB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
