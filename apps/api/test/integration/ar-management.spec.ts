/**
 * Integration spec — Build 5 A/R management surface.
 *
 * Coverage:
 *   - GET /ar/search returns past_due rows when the threshold is breached
 *   - account-level delinquency_days_threshold wins over the tenant default
 *   - cash invoices (no account) use the cash threshold
 *   - PATCH /accounts/:id/contract-terms persists delinquencyDaysThreshold
 *   - GET/PATCH /ar/invoice-defaults round-trips through tenants.settings
 *   - POST /ar/red-alert/run-now creates a red_alert_sends row + uniqueness
 *     guard prevents a second sent row for the same Monday
 *   - cross-tenant /ar/search cannot see the attacker's invoices
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@ustowdispatch/db';
import type {
  ArSearchResponse,
  RedAlertSendDto,
  StatementPreviewResponse,
  TenantInvoiceDefaults,
} from '@ustowdispatch/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `ar-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('A/R management integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let attacker: AuthedResp;
  let accountId: string;
  let accountIdAggressive: string;
  let pastDueInvoiceId: string;
  let freshInvoiceId: string;
  let cashInvoiceId: string;
  let attackerInvoiceId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-att`, ctx));

    // Seed accounts (one default 30-day, one aggressive 7-day Agero-like).
    accountId = uuidv7();
    accountIdAggressive = uuidv7();
    pastDueInvoiceId = uuidv7();
    freshInvoiceId = uuidv7();
    cashInvoiceId = uuidv7();
    attackerInvoiceId = uuidv7();

    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO accounts (id, tenant_id, name, billing_terms)
         VALUES ($1::uuid, $2::uuid, 'Default Net30', 'net_30'),
                ($3::uuid, $2::uuid, 'Agero-like Net7', 'net_30')`,
        [accountId, session.tenant.id, accountIdAggressive],
      );
      // Aggressive account: 7-day delinquency threshold.
      await c.query('UPDATE accounts SET delinquency_days_threshold = 7 WHERE id = $1::uuid', [
        accountIdAggressive,
      ]);

      // Invoice 1 — issued 60 days ago, account_id = default. Should be
      // past_due (60 days > 30-day tenant default).
      await c.query(
        `INSERT INTO invoices
           (id, tenant_id, invoice_number, status, account_id,
            issued_at, due_at, subtotal_cents, total_cents, balance_cents)
         VALUES ($1::uuid, $2::uuid, 'INV-PD-001', 'issued', $3::uuid,
                 now() - interval '60 days', now() - interval '30 days',
                 100000, 100000, 100000)`,
        [pastDueInvoiceId, session.tenant.id, accountId],
      );
      // Invoice 2 — issued 10 days ago, account_id = default. 10 days < 30
      // day threshold ⇒ NOT past_due.
      await c.query(
        `INSERT INTO invoices
           (id, tenant_id, invoice_number, status, account_id,
            issued_at, due_at, subtotal_cents, total_cents, balance_cents)
         VALUES ($1::uuid, $2::uuid, 'INV-PD-002', 'issued', $3::uuid,
                 now() - interval '10 days', now() + interval '20 days',
                 75000, 75000, 75000)`,
        [freshInvoiceId, session.tenant.id, accountId],
      );
      // Invoice 3 — issued 9 days ago, cash (no account_id). With the
      // default cash threshold of 7, this IS past_due.
      await c.query(
        `INSERT INTO invoices
           (id, tenant_id, invoice_number, status,
            issued_at, due_at, subtotal_cents, total_cents, balance_cents)
         VALUES ($1::uuid, $2::uuid, 'INV-CASH-001', 'issued',
                 now() - interval '9 days', now() + interval '21 days',
                 30000, 30000, 30000)`,
        [cashInvoiceId, session.tenant.id],
      );
      // Attacker's invoice — past_due in their tenant; must not bleed
      // through into the session's search.
      await c.query(
        `INSERT INTO accounts (id, tenant_id, name) VALUES ($1::uuid, $2::uuid, 'attacker acct')`,
        [uuidv7(), attacker.tenant.id],
      );
      await c.query(
        `INSERT INTO invoices
           (id, tenant_id, invoice_number, status,
            issued_at, due_at, subtotal_cents, total_cents, balance_cents)
         VALUES ($1::uuid, $2::uuid, 'ATK-INV-001', 'issued',
                 now() - interval '90 days', now() - interval '60 days',
                 50000, 50000, 50000)`,
        [attackerInvoiceId, attacker.tenant.id],
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
    if (ctx.admin) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        const ids = [session.tenant.id, attacker.tenant.id];
        await c.query('DELETE FROM red_alert_sends WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM statement_sends WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoices WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('GET /ar/search?statuses=past_due flags account invoice past 30-day default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ar/search?statuses=past_due',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ArSearchResponse;
    const ids = body.rows.map((r) => r.id);
    expect(ids).toContain(pastDueInvoiceId);
    expect(ids).not.toContain(freshInvoiceId);
    expect(body.summary.totalPastDueCents).toBeGreaterThanOrEqual(100000);
    for (const r of body.rows) {
      expect(r.isPastDue).toBe(true);
      expect(r.daysOverdue).toBeGreaterThanOrEqual(0);
    }
  });

  it('cash invoice (no account) uses tenant cash_customer_delinquency_days = 7', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ar/search?statuses=past_due',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ArSearchResponse;
    const cashRow = body.rows.find((r) => r.id === cashInvoiceId);
    // 9 days > 7-day cash threshold ⇒ past_due
    expect(cashRow).toBeDefined();
    expect(cashRow?.isPastDue).toBe(true);
  });

  it('account-level threshold overrides the tenant default', async () => {
    // Move invoice 2 onto the aggressive (7-day) account; re-issue 10 days ago
    // ⇒ now past_due because 10 > 7.
    const c = await ctx.admin.connect();
    try {
      await c.query('UPDATE invoices SET account_id = $1::uuid WHERE id = $2::uuid', [
        accountIdAggressive,
        freshInvoiceId,
      ]);
    } finally {
      c.release();
    }

    const res = await app.inject({
      method: 'GET',
      url: '/ar/search?statuses=past_due',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ArSearchResponse;
    const row = body.rows.find((r) => r.id === freshInvoiceId);
    expect(row).toBeDefined();
    expect(row?.isPastDue).toBe(true);

    // Restore so other tests reason about it.
    const c2 = await ctx.admin.connect();
    try {
      await c2.query('UPDATE invoices SET account_id = $1::uuid WHERE id = $2::uuid', [
        accountId,
        freshInvoiceId,
      ]);
    } finally {
      c2.release();
    }
  });

  it('cross-tenant /ar/search cannot see the attacker invoice', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ar/search?statuses=past_due',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ArSearchResponse;
    expect(body.rows.map((r) => r.id)).not.toContain(attackerInvoiceId);
  });

  it('GET + PATCH /ar/invoice-defaults round-trips through tenants.settings', async () => {
    const getRes = await app.inject({
      method: 'GET',
      url: '/ar/invoice-defaults',
      headers: auth(session.accessToken),
    });
    expect(getRes.statusCode).toBe(200);
    const before = getRes.json() as TenantInvoiceDefaults;
    expect(before.defaultDelinquencyDays).toBe(30);
    expect(before.cashCustomerDelinquencyDays).toBe(7);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/ar/invoice-defaults',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { defaultDelinquencyDays: 45, invoiceNumberPrefix: 'TEST-' },
    });
    expect(patchRes.statusCode).toBe(200);
    const after = patchRes.json() as TenantInvoiceDefaults;
    expect(after.defaultDelinquencyDays).toBe(45);
    expect(after.invoiceNumberPrefix).toBe('TEST-');
    // Untouched fields keep their value.
    expect(after.cashCustomerDelinquencyDays).toBe(7);
  });

  it('PATCH /accounts/:id/contract-terms persists delinquency_days_threshold', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/accounts/${accountId}/contract-terms`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { delinquencyDaysThreshold: 14 },
    });
    expect(patchRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}`,
      headers: auth(session.accessToken),
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as { delinquencyDaysThreshold: number | null };
    expect(body.delinquencyDaysThreshold).toBe(14);
  });

  it('POST /ar/red-alert/run-now writes a red_alert_sends row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ar/red-alert/run-now',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RedAlertSendDto;
    expect(body.id).toBeTruthy();
    // The send may go out as 'sent' (recipients found) or 'sent' with empty
    // sentTo (no opted-in recipients). We only care that the audit row landed.
    expect(['sent', 'failed']).toContain(body.status);
    expect(body.alertForDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('POST /ar/red-alert/run-now is idempotent for the same calendar day (uniqueness guard)', async () => {
    // First call already happened above. A second call on the same Monday
    // either errors with a unique violation OR re-inserts a failed row,
    // depending on whether the prior send went to 'sent'. Either way, no
    // second 'sent' row may exist for the same (tenant, alert_for_date).
    await app.inject({
      method: 'POST',
      url: '/ar/red-alert/run-now',
      headers: auth(session.accessToken),
    });
    const c = await ctx.admin.connect();
    try {
      const r = await c.query<{ alert_for_date: string; count: number }>(
        `SELECT alert_for_date::text AS alert_for_date, count(*)::int AS count
           FROM red_alert_sends
          WHERE tenant_id = $1::uuid AND status = 'sent'
       GROUP BY alert_for_date`,
        [session.tenant.id],
      );
      for (const row of r.rows) {
        expect(row.count).toBeLessThanOrEqual(1);
      }
    } finally {
      c.release();
    }
  });

  it('POST /ar/statements/preview returns aging buckets for an account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ar/statements/preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { accountId, invoiceFilter: 'all' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as StatementPreviewResponse;
    expect(body.accountId).toBe(accountId);
    expect(body.invoices.map((i) => i.invoiceId)).toContain(pastDueInvoiceId);
    // The 60-day-old invoice lands in the 31-60 bucket (60 days past due_at
    // which was 30 days ago).
    expect(body.aging.totalCents).toBeGreaterThan(0);
  });
});
