/**
 * RLS isolation contract for invoice_line_commissions (Admin Settings
 * build 4 of 6). Mirrors the service_rates RLS template:
 *
 *   1) two tenants seeded via admin; each gets one invoice + one line
 *   2) under tenant A's GUC, INSERT a commission row — succeeds
 *   3) under tenant A's GUC, SELECT — only A's row is visible (B hidden)
 *   4) UPDATE B's row from A's context — rowcount = 0
 *   5) INSERT B's row from A's context — RLS WITH CHECK / consistency
 *      trigger rejects
 *   6) without any GUC — SELECT returns zero rows (fail-closed)
 *
 * Plus the per-line sum-check trigger (specific to this table):
 *   7) inserting a second commission that would push line total > 100 → reject
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — invoice_line_commissions', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let invoiceA: string;
  let invoiceB: string;
  let lineA: string;
  let lineB: string;
  let driverA: string;
  let driverB: string;
  const slugA = `ilc-rls-a-${Date.now()}`;
  const slugB = `ilc-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    invoiceA = uuidv7();
    invoiceB = uuidv7();
    lineA = uuidv7();
    lineB = uuidv7();
    driverA = uuidv7();
    driverB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, 'A', 'active'), ($3, $4, 'B', 'active')`,
        [tenantA, slugA, tenantB, slugB],
      );
      // Seed invoices, line items, and drivers for each tenant.
      for (const [tid, iid, lid, did] of [
        [tenantA, invoiceA, lineA, driverA],
        [tenantB, invoiceB, lineB, driverB],
      ] as Array<[string, string, string, string]>) {
        await c.query(
          `INSERT INTO invoices (id, tenant_id, invoice_number, invoice_type, status)
           VALUES ($1::uuid, $2::uuid, $3, 'manual', 'draft')`,
          [iid, tid, `INV-DRAFT-${iid.replace(/-/g, '').slice(0, 16)}`],
        );
        await c.query(
          `INSERT INTO invoice_line_items (id, tenant_id, invoice_id, line_number, line_type,
                                            description, quantity, unit, unit_price_cents, line_total_cents)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'service', 'Tow', '1', 'each', 10000, 10000)`,
          [lid, tid, iid],
        );
        await c.query(
          `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
           VALUES ($1::uuid, $2::uuid, 'Crew', 'Test', 'A', true)`,
          [did, tid],
        );
      }
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
        const ids = [tenantA, tenantB];
        await c.query('DELETE FROM invoice_line_commissions WHERE tenant_id = ANY($1::uuid[])', [
          ids,
        ]);
        await c.query('DELETE FROM invoice_line_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoices WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM drivers WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
        } finally {
          await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
        }
        await c.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
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

  it('insert under tenant A context creates exactly one row visible to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO invoice_line_commissions
           (id, tenant_id, invoice_id, invoice_line_item_id, driver_id, commission_pct, commission_amount_cents)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 25, 0)`,
        [uuidv7(), tenantA, invoiceA, lineA, driverA],
      );
      const r = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM invoice_line_commissions',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's commission rows", async () => {
    // Seed a B commission via admin so RLS has something to hide.
    const ac = await admin.connect();
    try {
      await ac.query(
        `INSERT INTO invoice_line_commissions
           (id, tenant_id, invoice_id, invoice_line_item_id, driver_id, commission_pct, commission_amount_cents)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 50, 0)`,
        [uuidv7(), tenantB, invoiceB, lineB, driverB],
      );
    } finally {
      ac.release();
    }

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM invoice_line_commissions',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("UPDATE on tenant B's commission row from tenant A's context affects zero rows", async () => {
    let bRowId = '';
    const ac = await admin.connect();
    try {
      const r = await ac.query<{ id: string }>(
        'SELECT id FROM invoice_line_commissions WHERE tenant_id = $1 LIMIT 1',
        [tenantB],
      );
      bRowId = r.rows[0]?.id as string;
      expect(bRowId).toBeTruthy();
    } finally {
      ac.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        'UPDATE invoice_line_commissions SET commission_pct = 1 WHERE id = $1::uuid',
        [bRowId],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("INSERT with tenant_id = B from tenant A's context is rejected", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO invoice_line_commissions
             (id, tenant_id, invoice_id, invoice_line_item_id, driver_id, commission_pct, commission_amount_cents)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 10, 0)`,
          [uuidv7(), tenantB, invoiceB, lineB, driverB],
        ),
        // Either RLS WITH CHECK rejects the foreign tenant_id, or the
        // BEFORE consistency trigger blocks it after looking up the
        // parent rows. Both outcomes constitute a successful block.
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

  it('without GUCs set, no commission rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT id FROM invoice_line_commissions');
      expect(r.rows).toHaveLength(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('per-line commission sum > 100 is rejected by trg_invoice_line_commission_sum_check', async () => {
    // A's earlier insert was 25%. Try to add a second row at 80% — total
    // would be 105, which the BEFORE trigger must reject.
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      // Insert a second driver to attach the over-budget row to.
      const driver2 = uuidv7();
      const ac = await admin.connect();
      try {
        await ac.query(
          `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
           VALUES ($1::uuid, $2::uuid, 'Second', 'Driver', 'A', true)`,
          [driver2, tenantA],
        );
      } finally {
        ac.release();
      }
      await expect(
        c.query(
          `INSERT INTO invoice_line_commissions
             (id, tenant_id, invoice_id, invoice_line_item_id, driver_id, commission_pct, commission_amount_cents)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 80, 0)`,
          [uuidv7(), tenantA, invoiceA, lineA, driver2],
        ),
      ).rejects.toThrowError(/exceed|exceeding|sum to/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('per-line commission sum ≤ 100 succeeds', async () => {
    // 25 + 70 = 95 — within budget.
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const driver3 = uuidv7();
      const ac = await admin.connect();
      try {
        await ac.query(
          `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
           VALUES ($1::uuid, $2::uuid, 'Third', 'Driver', 'A', true)`,
          [driver3, tenantA],
        );
      } finally {
        ac.release();
      }
      const res = await c.query(
        `INSERT INTO invoice_line_commissions
           (id, tenant_id, invoice_id, invoice_line_item_id, driver_id, commission_pct, commission_amount_cents)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 70, 0)
         RETURNING id`,
        [uuidv7(), tenantA, invoiceA, lineA, driver3],
      );
      expect(res.rowCount).toBe(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
