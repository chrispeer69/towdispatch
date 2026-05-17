/**
 * RLS isolation contract for the user_invites table (Admin Settings build
 * 7 of 7). Mirrors the service_rates RLS template:
 *
 *   1) Without app.current_tenant_id, no rows visible (fail-closed).
 *   2) Tenant A cannot see tenant B's rows.
 *   3) UPDATE from A on B's row affects zero rows.
 *   4) INSERT with foreign tenant_id is rejected by WITH CHECK.
 *   5) fn_lookup_invite_by_token bypasses RLS for the single-token lookup
 *      (so the public /accept-invite page can resolve the invite without
 *      a session).
 *   6) token_hash uniqueness — duplicate hash insert is rejected.
 */
import { createHash } from 'node:crypto';
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

describeIfDb('RLS tenant isolation — user_invites', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let inviterA: string;
  let inviterB: string;
  const slugA = `inv-rls-a-${Date.now()}`;
  const slugB = `inv-rls-b-${Date.now()}`;
  const tokenA = `token-A-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tokenB = `token-B-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let inviteIdA: string;
  let inviteIdB: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    inviterA = uuidv7();
    inviterB = uuidv7();
    inviteIdA = uuidv7();
    inviteIdB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'Invite RLS A', tenantB, slugB, 'Invite RLS B'],
      );
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'x', 'Inv', 'A', 'owner'),
                ($4, $5, $6, 'x', 'Inv', 'B', 'owner')`,
        [inviterA, tenantA, `${slugA}-inviter@spec.test`, inviterB, tenantB, `${slugB}-inviter@spec.test`],
      );
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await c.query(
        `INSERT INTO user_invites
           (id, tenant_id, email, role, invited_by, token_hash, expires_at)
         VALUES ($1, $2, $3, 'dispatcher', $4, $5, $6),
                ($7, $8, $9, 'dispatcher', $10, $11, $12)`,
        [
          inviteIdA, tenantA, `pending-a-${Date.now()}@spec.test`, inviterA, hashToken(tokenA), expiresAt,
          inviteIdB, tenantB, `pending-b-${Date.now()}@spec.test`, inviterB, hashToken(tokenB), expiresAt,
        ],
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
        await c.query('DELETE FROM user_invites WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  it('without GUCs set, no user_invites rows are visible (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM user_invites');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it("tenant A cannot see tenant B's invites", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const res = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM user_invites');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("UPDATE on tenant B's invite from tenant A's context affects zero rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        "UPDATE user_invites SET full_name = 'pwned' WHERE id = $1::uuid",
        [inviteIdB],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('INSERT with tenant_id = B from tenant A is rejected by RLS WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const expiresAt = new Date(Date.now() + 60_000);
      await expect(
        c.query(
          `INSERT INTO user_invites
             (id, tenant_id, email, role, invited_by, token_hash, expires_at)
           VALUES ($1::uuid, $2::uuid, $3, 'dispatcher', $4::uuid, $5, $6)`,
          [uuidv7(), tenantB, `injected-${Date.now()}@spec.test`, inviterA, hashToken('x'), expiresAt],
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

  it('fn_lookup_invite_by_token bypasses RLS for unauthenticated lookup', async () => {
    const c = await app.connect();
    try {
      const res = await c.query<{ invite_id: string; tenant_id: string; email: string }>(
        'SELECT invite_id, tenant_id, email FROM fn_lookup_invite_by_token($1)',
        [hashToken(tokenA)],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.invite_id).toBe(inviteIdA);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
    } finally {
      c.release();
    }
  });

  it('token_hash uniqueness — duplicate token_hash insert is rejected', async () => {
    const c = await admin.connect();
    try {
      const expiresAt = new Date(Date.now() + 60_000);
      await expect(
        c.query(
          `INSERT INTO user_invites
             (id, tenant_id, email, role, invited_by, token_hash, expires_at)
           VALUES ($1::uuid, $2::uuid, $3, 'dispatcher', $4::uuid, $5, $6)`,
          [
            uuidv7(),
            tenantA,
            `dupe-${Date.now()}@spec.test`,
            inviterA,
            hashToken(tokenA),
            expiresAt,
          ],
        ),
      ).rejects.toThrowError(/duplicate key|unique constraint/i);
    } finally {
      c.release();
    }
  });
});
