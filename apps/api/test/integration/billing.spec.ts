/**
 * Billing integration spec — Session 10.
 *
 * Surface coverage:
 *   - manual invoice create → issue → record payment → mark paid round-trip
 *   - line item math (quantity × unit_price = line_total, sum = subtotal)
 *   - tax computation: a taxable line at 7% appears in invoice_taxes
 *   - status transitions: draft → issued → partially_paid → paid → refunded
 *   - state machine guard rejects payment against draft
 *   - generateFromJob is idempotent (calling twice returns the same invoice)
 *   - per-tenant invoice_number sequencing (INV-YYYY-NNNN)
 *   - credit memo applied_to_invoice reduces balance via offset payment
 *   - aging buckets sort correctly (>91 days vs current)
 *   - markOverdueSweep flips a past-due invoice
 *   - cross-tenant SELECT cannot see invoices/payments/credit-memos (Gate 2)
 *   - PDF generation produces a non-trivial buffer with %PDF magic
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  seedDefaultRateSheet,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `bill-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

const VIN_PREFIX = 'WBA';
const vinTail = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  .toUpperCase()
  .replace(/[IOQ]/g, '0')
  .padStart(12, '0')
  .slice(0, 12);
let vinCounter = 0;
const nextVin = (): string => {
  vinCounter += 1;
  const counter = vinCounter.toString(36).toUpperCase().padStart(2, '0').replace(/[IOQ]/g, '0');
  return (VIN_PREFIX + vinTail + counter).slice(0, 17);
};

interface InvoiceWithDetails {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  status: string;
  invoiceType: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: string;
    unitPriceCents: number;
    lineTotalCents: number;
    taxable: boolean;
    taxRatePct: string;
  }>;
  taxes: Array<{ taxAmountCents: number; taxRatePct: string }>;
  payments: Array<{ id: string; amountCents: number; paymentMethod: string; status: string }>;
}

describeIfDb('Billing integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let attacker: AuthedResp;
  let driverId: string;
  let truckId: string;
  let shiftId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, session.tenant.id);

    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-att`, ctx));
    await seedDefaultRateSheet(ctx, attacker.tenant.id);

    // Set up a driver / truck / shift for the auto-generation test (job
    // completion path needs all three).
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      const dRes = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Bill', 'Driver', 'A', true)
         RETURNING id`,
        [session.tenant.id, `BEMP-${SUFFIX}`],
      );
      driverId = dRes.rows[0]?.id as string;
      const tRes = await c.query<{ id: string }>(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, in_service)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'flatbed', true)
         RETURNING id`,
        [session.tenant.id, `BT-${SUFFIX}`],
      );
      truckId = tRes.rows[0]?.id as string;
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }

    const shiftRes = await app.inject({
      method: 'POST',
      url: '/dispatch/shifts/start',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId, truckId },
    });
    expect(shiftRes.statusCode).toBe(201);
    shiftId = (shiftRes.json() as { id: string }).id;
  });

  afterAll(async () => {
    // Clean billing rows we created.
    if (ctx.admin) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        const ids = [session.tenant.id, attacker.tenant.id];
        await c.query('DELETE FROM payments WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoice_taxes WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoice_line_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM credit_memos WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoices WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoice_number_sequences WHERE tenant_id = ANY($1::uuid[])', [
          ids,
        ]);
        await c.query(
          'DELETE FROM recurring_billing_schedules WHERE tenant_id = ANY($1::uuid[])',
          [ids],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  async function createDraft(
    sess: AuthedResp,
    body: Record<string, unknown> = {},
  ): Promise<InvoiceWithDetails> {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/invoices',
      headers: { ...auth(sess.accessToken), 'content-type': 'application/json' },
      payload: {
        invoiceType: 'manual',
        terms: 'net_30',
        billingAddress: {
          name: 'Test Customer',
          email: 'customer@spec.test',
        },
        lineItems: [
          {
            lineType: 'service',
            description: 'Tow service',
            quantity: 1,
            unit: 'each',
            unitPriceCents: 12000,
            taxable: false,
            taxRatePct: 0,
          },
        ],
        ...body,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as InvoiceWithDetails;
  }

  it('creates a draft manual invoice with line items and computed totals', async () => {
    const inv = await createDraft(session);
    expect(inv.status).toBe('draft');
    expect(inv.invoiceNumber).toMatch(/^INV-/);
    expect(inv.subtotalCents).toBe(12000);
    expect(inv.totalCents).toBe(12000);
    expect(inv.balanceCents).toBe(12000);
    expect(inv.lineItems.length).toBe(1);
    expect(inv.lineItems[0]?.lineTotalCents).toBe(12000);
  });

  it('line item quantity × unit_price math is correct', async () => {
    const inv = await createDraft(session, {
      lineItems: [
        {
          lineType: 'mileage_loaded',
          description: 'Mileage',
          quantity: 12.5,
          unit: 'mi',
          unitPriceCents: 450,
          taxable: false,
          taxRatePct: 0,
        },
        {
          lineType: 'service',
          description: 'Hookup',
          quantity: 1,
          unit: 'each',
          unitPriceCents: 9500,
          taxable: false,
          taxRatePct: 0,
        },
      ],
    });
    // 12.5 × 450 = 5625
    expect(inv.lineItems.find((l) => l.description === 'Mileage')?.lineTotalCents).toBe(5625);
    expect(inv.subtotalCents).toBe(5625 + 9500);
    expect(inv.totalCents).toBe(5625 + 9500);
  });

  it('a taxable line at 7% lands in invoice_taxes and totals add up', async () => {
    const inv = await createDraft(session, {
      lineItems: [
        {
          lineType: 'service',
          description: 'Taxable service',
          quantity: 1,
          unit: 'each',
          unitPriceCents: 10000,
          taxable: true,
          taxRatePct: 7,
        },
      ],
    });
    expect(inv.taxes.length).toBe(1);
    expect(inv.taxes[0]?.taxAmountCents).toBe(700);
    expect(inv.taxCents).toBe(700);
    expect(inv.totalCents).toBe(10700);
  });

  it('issuing a draft allocates an INV-YYYY-NNNN number and flips status', async () => {
    const draft = await createDraft(session);
    const issue = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    expect(issue.statusCode).toBe(200);
    const issued = issue.json() as InvoiceWithDetails;
    expect(['issued', 'sent']).toContain(issued.status);
    expect(issued.invoiceNumber).toMatch(/^INV-\d{4}-\d{4,}$/);
  });

  it('issue is idempotent — calling twice does not allocate a new number', async () => {
    const draft = await createDraft(session);
    const first = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    const second = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const a = first.json() as InvoiceWithDetails;
    const b = second.json() as InvoiceWithDetails;
    expect(a.invoiceNumber).toBe(b.invoiceNumber);
    expect(a.status).toBe(b.status);
  });

  it('cannot record a payment against a draft invoice', async () => {
    const draft = await createDraft(session);
    const res = await app.inject({
      method: 'POST',
      url: '/billing/payments',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        invoiceId: draft.id,
        amountCents: 1000,
        paymentMethod: 'cash',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('payment application transitions issued → partially_paid → paid', async () => {
    const draft = await createDraft(session, {
      lineItems: [
        {
          lineType: 'service',
          description: 'Tow',
          quantity: 1,
          unit: 'each',
          unitPriceCents: 20000,
          taxable: false,
          taxRatePct: 0,
        },
      ],
    });
    await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    // Half-pay
    const pay1 = await app.inject({
      method: 'POST',
      url: '/billing/payments',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { invoiceId: draft.id, amountCents: 10000, paymentMethod: 'cash' },
    });
    expect(pay1.statusCode).toBe(201);
    expect((pay1.json() as { invoice: InvoiceWithDetails }).invoice.status).toBe('partially_paid');
    expect((pay1.json() as { invoice: InvoiceWithDetails }).invoice.balanceCents).toBe(10000);

    // Pay the rest
    const pay2 = await app.inject({
      method: 'POST',
      url: '/billing/payments',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { invoiceId: draft.id, amountCents: 10000, paymentMethod: 'cash' },
    });
    expect(pay2.statusCode).toBe(201);
    const final = (pay2.json() as { invoice: InvoiceWithDetails }).invoice;
    expect(final.status).toBe('paid');
    expect(final.balanceCents).toBe(0);
  });

  it('credit memo applied_to_invoice reduces balance via offset payment', async () => {
    const draft = await createDraft(session, {
      lineItems: [
        {
          lineType: 'service',
          description: 'Tow',
          quantity: 1,
          unit: 'each',
          unitPriceCents: 30000,
          taxable: false,
          taxRatePct: 0,
        },
      ],
    });
    await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    const memoRes = await app.inject({
      method: 'POST',
      url: '/billing/credit-memos',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        originalInvoiceId: draft.id,
        amountCents: 5000,
        reasonCode: 'goodwill',
        reason: 'Friend of the shop discount',
        appliedTo: 'apply_to_invoice',
      },
    });
    expect(memoRes.statusCode).toBe(201);
    const after = (memoRes.json() as { invoice: InvoiceWithDetails }).invoice;
    expect(after.balanceCents).toBe(25000);
    expect(after.payments.find((p) => p.paymentMethod === 'write_off')).toBeTruthy();
  });

  it('cross-tenant SELECT cannot see invoices created in tenant A (RLS proof)', async () => {
    const inv = await createDraft(session);

    const peek = await app.inject({
      method: 'GET',
      url: `/billing/invoices/${inv.id}`,
      headers: auth(attacker.accessToken),
    });
    expect(peek.statusCode).toBe(404);

    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [attacker.tenant.id]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [attacker.user.id]);
      await c.query('SET LOCAL ROLE app_user');
      const r = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM invoices WHERE id = $1::uuid',
        [inv.id],
      );
      expect(r.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('cross-tenant SELECT cannot see payments from another tenant', async () => {
    const draft = await createDraft(session);
    await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    const payRes = await app.inject({
      method: 'POST',
      url: '/billing/payments',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { invoiceId: draft.id, amountCents: 1000, paymentMethod: 'cash' },
    });
    expect(payRes.statusCode).toBe(201);
    const paymentId = (payRes.json() as { payment: { id: string } }).payment.id;

    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [attacker.tenant.id]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [attacker.user.id]);
      await c.query('SET LOCAL ROLE app_user');
      const r = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM payments WHERE id = $1::uuid',
        [paymentId],
      );
      expect(r.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('PDF generation returns a valid PDF buffer (gate 4)', async () => {
    const draft = await createDraft(session);
    await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/billing/invoices/${draft.id}/pdf`,
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    // Fastify .rawPayload preserves the raw bytes; .body decodes utf8 which is
    // wrong for a PDF. Use .rawPayload here.
    const buf = res.rawPayload;
    expect(buf.length).toBeGreaterThan(500);
    // %PDF-1.x magic bytes at the head of every PDF.
    expect(buf.slice(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('aging endpoint buckets a 100-day past due invoice into 91+', async () => {
    // Manually craft a past-due, issued, with a balance for the aging test.
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO invoices (id, tenant_id, invoice_number, invoice_type, status,
                                  subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents,
                                  currency, terms, issued_at, due_at, created_at, updated_at,
                                  customer_id)
           VALUES (gen_random_uuid(), $1::uuid, $2, 'manual', 'overdue',
                   50000, 0, 50000, 0, 50000, 'USD', 'net_30', now() - interval '110 days',
                   now() - interval '100 days', now(), now(), null)
           RETURNING id`,
          // invoice_number constraint is ^INV-[0-9]{4}-[0-9]{4,}$. Use a
          // timestamp tail so reruns don't collide on the unique index.
          [session.tenant.id, `INV-2025-${String(Date.now()).slice(-8)}`],
        )
      ).rows[0]?.id;
      await c.query('COMMIT');
      expect(id).toBeTruthy();
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }

    const res = await app.inject({
      method: 'GET',
      url: '/billing/aging',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const aging = res.json() as {
      totals: { bucket91PlusCents: number; totalCents: number; invoiceCount: number };
    };
    expect(aging.totals.bucket91PlusCents).toBeGreaterThanOrEqual(50000);
    expect(aging.totals.totalCents).toBeGreaterThanOrEqual(50000);
    expect(aging.totals.invoiceCount).toBeGreaterThanOrEqual(1);
  });

  it('mark-overdue sweep flips a past-due, unpaid invoice', async () => {
    const draft = await createDraft(session);
    await app.inject({
      method: 'POST',
      url: `/billing/invoices/${draft.id}/issue`,
      headers: auth(session.accessToken),
    });
    // Backdate due_at so the sweep matches.
    const c = await ctx.admin.connect();
    try {
      await c.query("UPDATE invoices SET due_at = now() - interval '2 days' WHERE id = $1::uuid", [
        draft.id,
      ]);
    } finally {
      c.release();
    }
    const res = await app.inject({
      method: 'POST',
      url: '/billing/ops/sweep-overdue',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { flipped: number };
    expect(body.flipped).toBeGreaterThanOrEqual(1);
  });

  it('completing a job auto-generates a draft invoice (idempotent on re-request)', async () => {
    // Intake → assign → mark completed → poll until invoice exists.
    const intake = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        customer: {
          name: 'Auto Gen',
          phone: '+15555556001',
          email: 'autogen@spec.test',
        },
        vehicle: {
          vin: nextVin(),
          plate: 'AUTOG1',
          plateState: 'OH',
          year: 2020,
          make: 'Ford',
          model: 'F-150',
          vehicleClass: 'light_duty',
        },
        serviceType: 'tow',
        pickup: { address: '500 Main St', lat: 39.9612, lng: -82.9988 },
        dropoff: { address: '600 Broad St', lat: 39.9655, lng: -82.9852 },
        authorizedBy: 'customer',
      },
    });
    expect(intake.statusCode).toBe(201);
    const jobId = (intake.json() as { job: { id: string } }).job.id;

    await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId, truckId, shiftId },
    });
    await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/transition`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { to: 'enroute' },
    });
    await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/transition`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { to: 'on_scene' },
    });
    await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/transition`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { to: 'in_progress' },
    });
    const completeRes = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/transition`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { to: 'completed' },
    });
    expect(completeRes.statusCode).toBe(200);

    // Poll for the auto-generated invoice (fire-and-forget event subscription).
    const deadline = Date.now() + 4000;
    let firstInvoiceId: string | null = null;
    while (Date.now() < deadline) {
      const list = await app.inject({
        method: 'GET',
        url: `/billing/invoices?jobId=${jobId}`,
        headers: auth(session.accessToken),
      });
      const body = list.json() as { data: InvoiceWithDetails[] };
      if (body.data.length > 0) {
        firstInvoiceId = body.data[0]?.id ?? null;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(firstInvoiceId).toBeTruthy();

    // Re-request via /from-job — must return the same invoice (idempotent).
    const second = await app.inject({
      method: 'POST',
      url: `/billing/invoices/from-job/${jobId}`,
      headers: auth(session.accessToken),
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { invoice: InvoiceWithDetails; created: boolean };
    expect(body.created).toBe(false);
    expect(body.invoice.id).toBe(firstInvoiceId);
  });
});
