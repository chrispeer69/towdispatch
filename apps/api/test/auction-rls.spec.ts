/**
 * RLS tenant-isolation spec for the Auction & Remarketing Marketplace
 * (Session 33). Mirrors impound-rls.spec.ts: an admin connection seeds two
 * tenants' rows, then an app_user connection (which respects RLS) proves a
 * tenant sees only its own listings / bids / bidders and cannot mutate or
 * inject across the boundary. Skips when no test DB is configured.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — auction marketplace', () => {
  let admin: Pool;
  let app: Pool;
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const bidderA = uuidv7();
  const bidderB = uuidv7();
  const listingA = uuidv7();
  const listingB = uuidv7();
  const bidA = uuidv7();
  const bidB = uuidv7();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [
          tenantA,
          `auc-rls-a-${Date.now()}`,
          'AUC RLS A',
          tenantB,
          `auc-rls-b-${Date.now()}`,
          'AUC RLS B',
        ],
      );
      await c.query(
        `INSERT INTO auction_bidders (id, tenant_id, name, email, password_hash, verified_at)
         VALUES ($1, $2, 'Buyer A', 'a@spec.test', 'x', now()),
                ($3, $4, 'Buyer B', 'b@spec.test', 'x', now())`,
        [bidderA, tenantA, bidderB, tenantB],
      );
      await c.query(
        `INSERT INTO auction_listings (id, tenant_id, starting_bid_cents, status)
         VALUES ($1, $2, 50000, 'live'), ($3, $4, 50000, 'live')`,
        [listingA, tenantA, listingB, tenantB],
      );
      await c.query(
        `INSERT INTO auction_bids (id, tenant_id, listing_id, bidder_id, bid_amount_cents)
         VALUES ($1, $2, $3, $4, 60000), ($5, $6, $7, $8, 60000)`,
        [bidA, tenantA, listingA, bidderA, bidB, tenantB, listingB, bidderB],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  it('auction_listings: tenant A sees only its own listing', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM auction_listings',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('auction_bids: tenant B cannot see tenant A bids', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      const r = await c.query('SELECT id FROM auction_bids WHERE id = $1::uuid', [bidA]);
      expect(r.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('auction_bidders: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query("UPDATE auction_bidders SET name = 'pwned' WHERE id = $1::uuid", [
        bidderB,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('auction_listings: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO auction_listings (id, tenant_id, starting_bid_cents, status)
           VALUES ($1, $2, 1000, 'draft')`,
          [uuidv7(), tenantB],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM auction_bids WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM auction_listing_photos WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM auction_listings WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM auction_bidders WHERE tenant_id IN ($1, $2)', [
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
});
