/**
 * RLS isolation + cross-tenant FK guards for the Impound & Storage
 * (Session 22) tables.
 *
 *   impound_yards    — standard tenant-scoped FORCE RLS table.
 *   impound_records  — RLS + the records consistency trigger (yard_id's
 *                      tenant must match the row's tenant).
 *   impound_holds    — RLS + the child consistency trigger (record's
 *                      tenant must match).
 *   impound_fees     — the daily_storage partial-unique idempotency index.
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

describeIfDb('RLS tenant isolation — impound & storage', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let yardA: string;
  let yardB: string;
  let recordA: string;
  let recordB: string;
  const slugA = `imp-rls-a-${Date.now()}`;
  const slugB = `imp-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    yardA = uuidv7();
    yardB = uuidv7();
    recordA = uuidv7();
    recordB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'IMP RLS A', tenantB, slugB, 'IMP RLS B'],
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
        // FK order: fees/holds/releases → records → yards → tenants
        await c.query('DELETE FROM impound_fees WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM impound_holds WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM impound_releases WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
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

  // ------------------------- impound_yards -------------------------

  it('impound_yards: tenant A sees only its own yard', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM impound_yards',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('impound_yards: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query("UPDATE impound_yards SET name = 'pwned' WHERE id = $1::uuid", [
        yardB,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('impound_yards: INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO impound_yards (id, tenant_id, name, code) VALUES ($1, $2, 'X', 'X1')`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('impound_yards: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM impound_yards');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // ------------------------- impound_records -------------------------

  it('impound_records: tenant A cannot see B', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM impound_records',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('impound_records: foreign yard_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO impound_records (id, tenant_id, yard_id, daily_fee_cents)
           VALUES ($1, $2, $3, 1000)`,
          [uuidv7(), tenantA, yardB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- impound_holds -------------------------

  it('impound_holds: a hold on A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO impound_holds (id, tenant_id, impound_record_id, hold_type)
         VALUES ($1, $2, $3, 'police')`,
        [uuidv7(), tenantA, recordA],
      );
      const r = await c.query('SELECT id FROM impound_holds');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('impound_holds: foreign record_id (B) under A is rejected by the child consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO impound_holds (id, tenant_id, impound_record_id, hold_type)
           VALUES ($1, $2, $3, 'police')`,
          [uuidv7(), tenantA, recordB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- impound_fees -------------------------

  it('impound_fees: a second daily_storage fee for the same day is blocked by the unique index', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO impound_fees (id, tenant_id, impound_record_id, fee_type, amount_cents, accrued_for_date)
         VALUES ($1, $2, $3, 'daily_storage', 3500, '2026-05-20')`,
        [uuidv7(), tenantA, recordA],
      );
      await expect(
        c.query(
          `INSERT INTO impound_fees (id, tenant_id, impound_record_id, fee_type, amount_cents, accrued_for_date)
           VALUES ($1, $2, $3, 'daily_storage', 3500, '2026-05-20')`,
          [uuidv7(), tenantA, recordA],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('impound_fees: daily_storage without accrued_for_date is rejected by CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO impound_fees (id, tenant_id, impound_record_id, fee_type, amount_cents)
           VALUES ($1, $2, $3, 'daily_storage', 3500)`,
          [uuidv7(), tenantA, recordA],
        ),
      ).rejects.toThrowError(/impound_fees_daily_requires_date|check/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
