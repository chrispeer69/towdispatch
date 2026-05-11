/**
 * Reporting RLS isolation test.
 *
 * Inserts a saved_report for tenant A, then tries to read it while connected
 * as tenant B. RLS must hide it (zero rows returned). Also asserts that
 * inserting a saved_report with tenant A's id from a tenant B context fails.
 *
 * This is the Session 14 leg of the RLS contract test — same pattern as
 * apps/api/test/rls.spec.ts; if either fails on a PR, treat it as a P0.
 */
import { uuidv7 } from '@towcommand/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('reporting — RLS isolation for saved_reports', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  let savedAId: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL!, max: 2 });
    app = new Pool({ connectionString: APP_URL!, max: 4 });
    tenantA = uuidv7();
    tenantB = uuidv7();
    userA = uuidv7();
    userB = uuidv7();
    savedAId = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES
           ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [
          tenantA,
          `rpt-a-${Date.now()}`,
          'A',
          tenantB,
          `rpt-b-${Date.now()}`,
          'B',
        ],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
           VALUES ($1,$2,$3,'x','U','A','owner'), ($4,$5,$6,'x','U','B','owner')`,
        [
          userA,
          tenantA,
          `a-${Date.now()}@x.test`,
          userB,
          tenantB,
          `b-${Date.now()}@x.test`,
        ],
      );
      await c.query(
        `INSERT INTO saved_reports (id, tenant_id, name, report_id, filters, owner_user_id)
           VALUES ($1, $2, 'A revenue', 'revenue', '{}'::jsonb, $3)`,
        [savedAId, tenantA, userA],
      );
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query(`DELETE FROM saved_reports WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
        await c.query(`DELETE FROM users WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
        await c.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]);
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
      await admin.end();
    }
    if (app) await app.end();
  });

  it("tenant B's context cannot read tenant A's saved_report", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userB]);
      const r = await c.query<{ id: string }>(
        `SELECT id FROM saved_reports WHERE id = $1`,
        [savedAId],
      );
      expect(r.rows.length).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tenant B's context cannot INSERT a saved_report with tenant A's id", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userB]);
      await expect(
        c.query(
          `INSERT INTO saved_reports (id, tenant_id, name, report_id, filters, owner_user_id)
             VALUES ($1, $2, 'sneaky', 'revenue', '{}'::jsonb, $3)`,
          [uuidv7(), tenantA, userB],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it("tenant A's context can read tenant A's saved_report", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [userA]);
      const r = await c.query<{ id: string }>(
        `SELECT id FROM saved_reports WHERE id = $1`,
        [savedAId],
      );
      expect(r.rows.length).toBe(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
