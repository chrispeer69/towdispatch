/**
 * RLS isolation for the five CADS tables (Session 58):
 *   capacity_settings, capacity_snapshots, capacity_overrides,
 *   capacity_partners, capacity_broadcasts.
 *
 * Mirrors the dynamic_pricing_tiers RLS template per table:
 *   1) without GUC → SELECT returns zero rows (fail-closed)
 *   2) tenant A insert visible only to A
 *   3) tenant A cannot see B's rows
 *   4) UPDATE B's row from A context affects zero rows
 *   5) DELETE is denied outright for the app role (0002_roles grants
 *      app_user SELECT/INSERT/UPDATE only — the soft-delete-only invariant)
 *   6) INSERT with foreign tenant_id rejected by RLS WITH CHECK
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

interface TableCase {
  table: string;
  /** Insert one row for the given tenant. Runs on the provided client. */
  insert: (c: PoolClient, tenantId: string) => Promise<void>;
  /** Column to UPDATE in the cross-tenant update probe. */
  updateSql: string;
}

describeIfDb('RLS tenant isolation — CADS capacity tables', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  // partner ids per tenant so broadcasts can reference them.
  let partnerA: string;
  let partnerB: string;
  const slugA = `cads-rls-a-${Date.now()}`;
  const slugB = `cads-rls-b-${Date.now()}`;

  const userFor = (tenantId: string) => (tenantId === tenantA ? userA : userB);
  const partnerFor = (tenantId: string) => (tenantId === tenantA ? partnerA : partnerB);

  const cases: TableCase[] = [
    {
      table: 'capacity_settings',
      insert: async (c, tenantId) => {
        await c.query('INSERT INTO capacity_settings (id, tenant_id) VALUES ($1::uuid, $2::uuid)', [
          uuidv7(),
          tenantId,
        ]);
      },
      updateSql: 'guideline_minutes = 99',
    },
    {
      table: 'capacity_snapshots',
      insert: async (c, tenantId) => {
        await c.query(
          `INSERT INTO capacity_snapshots (id, tenant_id, duty_class, band, eligible_drivers, weighted_active_jobs)
           VALUES ($1::uuid, $2::uuid, 'light', 'available_now', 2, 1.0)`,
          [uuidv7(), tenantId],
        );
      },
      updateSql: "band = 'at_capacity'",
    },
    {
      table: 'capacity_overrides',
      insert: async (c, tenantId) => {
        await c.query(
          `INSERT INTO capacity_overrides (id, tenant_id, duty_class, forced_band, reason, expires_at, created_by)
           VALUES ($1::uuid, $2::uuid, 'all', 'at_capacity', 'storm mode', now() + interval '1 hour', $3::uuid)`,
          [uuidv7(), tenantId, userFor(tenantId)],
        );
      },
      updateSql: "reason = 'tampered'",
    },
    {
      table: 'capacity_partners',
      insert: async (c, tenantId) => {
        await c.query(
          `INSERT INTO capacity_partners (id, tenant_id, name, network_code, delivery_mode, webhook_url, webhook_secret_encrypted)
           VALUES ($1::uuid, $2::uuid, $3, 'generic', 'webhook', 'https://example.com/hook', 'ZmFrZQ==')`,
          [uuidv7(), tenantId, `Partner ${uuidv7().slice(0, 8)}`],
        );
      },
      updateSql: 'enabled = false',
    },
    {
      table: 'capacity_broadcasts',
      insert: async (c, tenantId) => {
        await c.query(
          `INSERT INTO capacity_broadcasts (id, tenant_id, partner_id, payload, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, '{"schema_version":"1.0"}'::jsonb, 'pending')`,
          [uuidv7(), tenantId, partnerFor(tenantId)],
        );
      },
      updateSql: "status = 'delivered'",
    },
  ];

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    userA = uuidv7();
    userB = uuidv7();
    partnerA = uuidv7();
    partnerB = uuidv7();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'CADS RLS A', tenantB, slugB, 'CADS RLS B'],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'x', 'Rls', 'A', 'admin'), ($4, $5, $6, 'x', 'Rls', 'B', 'admin')`,
        [userA, tenantA, `${slugA}@test.local`, userB, tenantB, `${slugB}@test.local`],
      );
      // Partners seeded via admin so capacity_broadcasts FKs resolve in both tenants.
      await c.query(
        `INSERT INTO capacity_partners (id, tenant_id, name, network_code, delivery_mode, webhook_url, webhook_secret_encrypted)
         VALUES ($1, $2, 'FK anchor A', 'generic', 'webhook', 'https://example.com/a', 'ZmFrZQ=='),
                ($3, $4, 'FK anchor B', 'generic', 'webhook', 'https://example.com/b', 'ZmFrZQ==')`,
        [partnerA, tenantA, partnerB, tenantB],
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
          'capacity_broadcasts',
          'capacity_overrides',
          'capacity_snapshots',
          'capacity_settings',
          'capacity_partners',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
        }
        await c.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  for (const tc of cases) {
    describe(tc.table, () => {
      it('without tenant context, SELECT returns no rows (fail-closed)', async () => {
        const c = await app.connect();
        try {
          await c.query('BEGIN');
          const res = await c.query(`SELECT count(*)::int AS n FROM ${tc.table}`);
          expect(res.rows[0]?.n).toBe(0);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      });

      it('insert under tenant A is visible only to A', async () => {
        const c = await app.connect();
        try {
          await c.query('BEGIN');
          await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
          await tc.insert(c, tenantA);
          const res = await c.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM ${tc.table}`,
          );
          expect(res.rows).toHaveLength(1);
          expect(res.rows[0]?.tenant_id).toBe(tenantA);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      });

      it("tenant A cannot see tenant B's rows", async () => {
        const adminC = await admin.connect();
        try {
          await tc.insert(adminC, tenantB);
        } finally {
          adminC.release();
        }
        const c = await app.connect();
        try {
          await c.query('BEGIN');
          await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
          const res = await c.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM ${tc.table}`,
          );
          expect(res.rows.map((r) => r.tenant_id)).toEqual([tenantA]);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      });

      it("UPDATE B's row from tenant A context affects zero rows", async () => {
        const c = await app.connect();
        try {
          await c.query('BEGIN');
          await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
          const res = await c.query(`UPDATE ${tc.table} SET ${tc.updateSql} WHERE tenant_id = $1`, [
            tenantB,
          ]);
          expect(res.rowCount).toBe(0);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      });

      it('DELETE is denied outright for the app role (soft-delete-only)', async () => {
        const c = await app.connect();
        try {
          await c.query('BEGIN');
          await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
          await expect(
            c.query(`DELETE FROM ${tc.table} WHERE tenant_id = $1`, [tenantB]),
          ).rejects.toThrow(/permission denied/);
          await c.query('ROLLBACK');
        } finally {
          c.release();
        }
      });

      it('INSERT with foreign tenant_id is rejected by WITH CHECK', async () => {
        const c = await app.connect();
        try {
          await c.query('BEGIN');
          await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
          await expect(tc.insert(c, tenantB)).rejects.toThrow();
          await c.query('ROLLBACK');
        } finally {
          c.release();
        }
      });
    });
  }
});
