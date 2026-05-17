/**
 * RLS isolation for Build 5 audit tables — statement_sends + red_alert_sends.
 *
 * Mirrors the Build 6 service_rates / account_rate_overrides templates:
 * two tenants in admin-pool seeding, separate tenant_id GUCs in app-pool
 * transactions, proves
 *   - row visibility is gated to the caller's tenant
 *   - INSERT with a foreign tenant_id is rejected by the policy
 *   - UPDATE with a foreign tenant_id touches zero rows
 *   - without a GUC, every read is fail-closed (zero rows)
 *
 * The Monday RED ALERT uniqueness guard (partial unique index on
 * (tenant_id, alert_for_date) WHERE status='sent') gets its own assertion
 * — admin pool inserts two 'sent' rows for the same tenant/date and the
 * second one is rejected by the unique-violation.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — statement_sends + red_alert_sends', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let accountIdA: string;
  let accountIdB: string;
  const slugA = `ar-rls-a-${Date.now()}`;
  const slugB = `ar-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    accountIdA = uuidv7();
    accountIdB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'AR RLS A', tenantB, slugB, 'AR RLS B'],
      );
      await c.query(
        `INSERT INTO accounts (id, tenant_id, name)
         VALUES ($1, $2, $3), ($4, $5, $6)`,
        [accountIdA, tenantA, 'A acct', accountIdB, tenantB, 'B acct'],
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
        await c.query('DELETE FROM red_alert_sends WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM statement_sends WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM accounts WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
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

  // ----- statement_sends -----

  it('statement_sends: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO statement_sends
           (id, tenant_id, account_id, sent_to, invoice_count, total_cents, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 3, 50000, 'sent')`,
        [uuidv7(), tenantA, accountIdA, 'a@example.com'],
      );
      const r = await c.query('SELECT tenant_id FROM statement_sends');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("statement_sends: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO statement_sends
           (id, tenant_id, account_id, sent_to, invoice_count, total_cents, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'b@example.com', 1, 1000, 'sent')`,
        [uuidv7(), tenantB, accountIdB],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM statement_sends',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('statement_sends: INSERT with foreign tenant_id from tenant A is rejected', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO statement_sends
             (id, tenant_id, account_id, sent_to, invoice_count, total_cents, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'x@x.com', 1, 1, 'sent')`,
          [uuidv7(), tenantB, accountIdB],
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

  it("statement_sends: UPDATE on tenant B's row from tenant A's context affects zero rows", async () => {
    let bRowId = '';
    const adminC = await admin.connect();
    try {
      const r = await adminC.query<{ id: string }>(
        'SELECT id FROM statement_sends WHERE tenant_id = $1 LIMIT 1',
        [tenantB],
      );
      bRowId = r.rows[0]?.id ?? '';
      expect(bRowId).toBeTruthy();
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query("UPDATE statement_sends SET status = 'failed' WHERE id = $1::uuid", [
        bRowId,
      ]);
      expect(r.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  // ----- red_alert_sends -----

  it('red_alert_sends: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO red_alert_sends
           (id, tenant_id, alert_for_date, sent_to, invoice_count, account_count,
            total_past_due_cents, breakdown_json, status)
         VALUES ($1::uuid, $2::uuid, '2026-05-18'::date, ARRAY['owner@a.com']::text[],
                 5, 2, 250000, '{}'::jsonb, 'sent')`,
        [uuidv7(), tenantA],
      );
      const r = await c.query('SELECT tenant_id FROM red_alert_sends');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("red_alert_sends: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO red_alert_sends
           (id, tenant_id, alert_for_date, sent_to, invoice_count, account_count,
            total_past_due_cents, breakdown_json, status)
         VALUES ($1::uuid, $2::uuid, '2026-05-18'::date, ARRAY['owner@b.com']::text[],
                 1, 1, 1000, '{}'::jsonb, 'sent')`,
        [uuidv7(), tenantB],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM red_alert_sends',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('red_alert_sends: uniqueness guard blocks a second sent row for the same Monday', async () => {
    const adminC = await admin.connect();
    try {
      const dupeDate = '2026-05-25'; // a Monday we own in this test
      await adminC.query(
        `INSERT INTO red_alert_sends
           (id, tenant_id, alert_for_date, sent_to, invoice_count, account_count,
            total_past_due_cents, breakdown_json, status)
         VALUES ($1::uuid, $2::uuid, $3::date, ARRAY[]::text[], 0, 0, 0, '{}'::jsonb, 'sent')`,
        [uuidv7(), tenantA, dupeDate],
      );
      await expect(
        adminC.query(
          `INSERT INTO red_alert_sends
             (id, tenant_id, alert_for_date, sent_to, invoice_count, account_count,
              total_past_due_cents, breakdown_json, status)
           VALUES ($1::uuid, $2::uuid, $3::date, ARRAY[]::text[], 0, 0, 0, '{}'::jsonb, 'sent')`,
          [uuidv7(), tenantA, dupeDate],
        ),
      ).rejects.toThrowError(/duplicate key|unique/i);

      // A 'failed' row for the same date IS allowed — the unique index is
      // partial (WHERE status='sent'), so retry attempts can co-exist with
      // a successful eventual send.
      await adminC.query(
        `INSERT INTO red_alert_sends
           (id, tenant_id, alert_for_date, sent_to, invoice_count, account_count,
            total_past_due_cents, breakdown_json, status)
         VALUES ($1::uuid, $2::uuid, $3::date, ARRAY[]::text[], 0, 0, 0, '{}'::jsonb, 'failed')`,
        [uuidv7(), tenantA, dupeDate],
      );
    } finally {
      adminC.release();
    }
  });

  it('without GUCs set, neither audit table returns rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const ss = await c.query('SELECT id FROM statement_sends');
      expect(ss.rows).toHaveLength(0);
      const ra = await c.query('SELECT id FROM red_alert_sends');
      expect(ra.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
