/**
 * RLS isolation + cross-tenant FK guard for Tier Offer Composer
 * (Session 1) tables.
 *
 *   1) tier_offers              — standard tenant-scoped table with audit
 *      trigger. Proves the FORCE RLS policy + WITH CHECK rejection +
 *      cross-tenant UPDATE invisibility + fail-closed-without-GUC.
 *
 *   2) tier_offer_recipients    — same RLS pattern PLUS the cross-tenant
 *      consistency BEFORE trigger that verifies offer_id's tenant AND
 *      account_id's tenant (when non-null) match the row's tenant_id.
 *      An ad-hoc recipient (account_id = NULL) must still pass the
 *      trigger's NULL short-circuit.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — tier offer composer', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let tierIdA: string;
  let tierIdB: string;
  let accountIdA: string;
  let accountIdB: string;
  let offerIdA: string;
  let offerIdB: string;
  const slugA = `toc-rls-a-${Date.now()}`;
  const slugB = `toc-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    tierIdA = uuidv7();
    tierIdB = uuidv7();
    accountIdA = uuidv7();
    accountIdB = uuidv7();
    offerIdA = uuidv7();
    offerIdB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'TOC RLS A', tenantB, slugB, 'TOC RLS B'],
      );
      await c.query(
        `INSERT INTO dynamic_pricing_tiers
           (id, tenant_id, name, category, multiplier, is_active)
         VALUES ($1::uuid, $2::uuid, 'TOC RLS Tier A', 'weather', 1.500, false),
                ($3::uuid, $4::uuid, 'TOC RLS Tier B', 'weather', 1.500, false)`,
        [tierIdA, tenantA, tierIdB, tenantB],
      );
      await c.query(
        'INSERT INTO accounts (id, tenant_id, name) VALUES ($1, $2, $3), ($4, $5, $6)',
        [accountIdA, tenantA, 'TOC RLS Account A', accountIdB, tenantB, 'TOC RLS Account B'],
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
        // FK order: recipients → offers → tiers/accounts → tenants
        await c.query('DELETE FROM tier_offer_recipients WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM tier_offers WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM dynamic_pricing_tiers WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM accounts WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  // -----------------------------------------------------------------------
  // 1) tier_offers
  // -----------------------------------------------------------------------

  const offerCols = `
    id, tenant_id, tier_id, title, subject_line, narrative,
    event_window_start, event_window_end, committed_truck_count,
    acceptance_deadline_at
  `;
  const offerValues = `
    $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
    now() + interval '1 day', now() + interval '2 day', 8,
    now() + interval '12 hour'
  `;

  it('tier_offers: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(`INSERT INTO tier_offers (${offerCols}) VALUES (${offerValues})`, [
        offerIdA,
        tenantA,
        tierIdA,
        'Snow A',
        'Snow A subj',
        'Body A',
      ]);
      const r = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM tier_offers');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tier_offers: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(`INSERT INTO tier_offers (${offerCols}) VALUES (${offerValues})`, [
        offerIdB,
        tenantB,
        tierIdB,
        'Snow B',
        'Snow B subj',
        'Body B',
      ]);
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM tier_offers');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tier_offers: UPDATE on tenant B's row from A's context affects zero rows", async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query("UPDATE tier_offers SET title = 'pwned' WHERE id = $1::uuid", [
        offerIdB,
      ]);
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tier_offers: INSERT with foreign tenant_id from A is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(`INSERT INTO tier_offers (${offerCols}) VALUES (${offerValues})`, [
          uuidv7(),
          tenantB,
          tierIdB,
          'Inject',
          'Inject subj',
          'Body',
        ]),
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

  it('tier_offers: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM tier_offers');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  // -----------------------------------------------------------------------
  // 2) tier_offer_recipients
  // -----------------------------------------------------------------------

  const recipCols = `
    id, tenant_id, offer_id, account_id, recipient_name, recipient_email,
    magic_link_token, magic_link_expires_at
  `;

  it('tier_offer_recipients: insert under tenant A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO tier_offer_recipients (${recipCols})
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, now() + interval '7 day')`,
        [
          uuidv7(),
          tenantA,
          offerIdA,
          accountIdA,
          'Sarah Lopez',
          'sarah-a@example.com',
          `tok-a-${Date.now()}-1`,
        ],
      );
      const r = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM tier_offer_recipients');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tier_offer_recipients: NULL account_id (ad-hoc email) is accepted by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO tier_offer_recipients (
           id, tenant_id, offer_id, recipient_name, recipient_email,
           magic_link_token, magic_link_expires_at
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, now() + interval '7 day')`,
        [uuidv7(), tenantA, offerIdA, 'Ad Hoc', 'adhoc-a@example.com', `tok-a-${Date.now()}-2`],
      );
      const r = await c.query<{ account_id: string | null }>(
        "SELECT account_id FROM tier_offer_recipients WHERE recipient_email = 'adhoc-a@example.com'",
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.account_id).toBeNull();
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it("tier_offer_recipients: tenant A cannot see tenant B's rows", async () => {
    const adminC = await admin.connect();
    try {
      await adminC.query(
        `INSERT INTO tier_offer_recipients (${recipCols})
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, now() + interval '7 day')`,
        [
          uuidv7(),
          tenantB,
          offerIdB,
          accountIdB,
          'Bob B',
          'bob-b@example.com',
          `tok-b-${Date.now()}`,
        ],
      );
    } finally {
      adminC.release();
    }
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM tier_offer_recipients',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('tier_offer_recipients: INSERT with foreign tenant_id from A is rejected (RLS or trigger)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO tier_offer_recipients (${recipCols})
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, now() + interval '7 day')`,
          [
            uuidv7(),
            tenantB,
            offerIdB,
            accountIdB,
            'Inject',
            'inject@example.com',
            `tok-inject-${Date.now()}`,
          ],
        ),
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

  it('tier_offer_recipients: foreign account_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO tier_offer_recipients (${recipCols})
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, now() + interval '7 day')`,
          [
            uuidv7(),
            tenantA,
            offerIdA,
            accountIdB,
            'Cross Account',
            'xacct@example.com',
            `tok-xacct-${Date.now()}`,
          ],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('tier_offer_recipients: foreign offer_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO tier_offer_recipients (
             id, tenant_id, offer_id, recipient_name, recipient_email,
             magic_link_token, magic_link_expires_at
           )
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, now() + interval '7 day')`,
          [
            uuidv7(),
            tenantA,
            offerIdB,
            'Cross Offer',
            'xoffer@example.com',
            `tok-xoffer-${Date.now()}`,
          ],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      c.release();
    }
  });

  it('tier_offer_recipients: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM tier_offer_recipients');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });
});
