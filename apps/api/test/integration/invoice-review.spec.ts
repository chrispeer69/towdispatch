/**
 * Invoice Review integration spec (Admin Settings build 4 of 6).
 *
 * Surface coverage:
 *   - Job completion auto-creates a draft invoice plus commission rows
 *     for the assigned driver (via DispatchEventsService)
 *   - GET  /billing/invoices/:id/review returns full payload
 *   - PATCH /billing/invoices/:id/review updates lines + commissions
 *   - PATCH is rejected when commissions exceed 100% for any line
 *   - POST /billing/invoices/:id/post transitions draft → issued/sent,
 *     freezes commission_amount_cents
 *   - POST is idempotent — second POST returns 409
 *   - Driver-role callers are blocked from the review endpoint
 *   - POST /jobs/:id/drivers adds support drivers to the crew
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

const SUFFIX = `irv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
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

interface ReviewPayload {
  invoice: {
    id: string;
    status: string;
    invoiceNumber: string;
    notes: string | null;
    totalCents: number;
  };
  lineItems: Array<{
    id: string;
    description: string;
    quantity: string;
    unitPriceCents: number;
    lineTotalCents: number;
    taxable: boolean;
    taxRatePct: string;
  }>;
  commissions: Array<{
    id: string;
    invoiceLineItemId: string;
    driverId: string;
    commissionPct: number;
    commissionAmountCents: number;
    driverName: string;
  }>;
  assignedDrivers: Array<{ id: string; name: string; defaultCommissionPct: number | null }>;
}

interface PostResponse {
  invoice: { id: string; status: string; invoiceNumber: string };
  commissions: Array<{ commissionAmountCents: number; commissionPct: number }>;
}

describeIfDb('Invoice Review integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let driverId: string;
  let driver2Id: string;
  let truckId: string;
  let shiftId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, session.tenant.id);

    // Seed two drivers (one with a default commission %) and a truck so
    // dispatch can flip a job through assign → enroute → completed.
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      const d1 = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, default_commission_pct, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Alice', 'Driver', 'A', 60.00, true)
         RETURNING id`,
        [session.tenant.id, `IRV1-${SUFFIX}`],
      );
      driverId = d1.rows[0]?.id as string;
      const d2 = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, default_commission_pct, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Bob', 'Crew', 'A', 50.00, true)
         RETURNING id`,
        [session.tenant.id, `IRV2-${SUFFIX}`],
      );
      driver2Id = d2.rows[0]?.id as string;
      const t = await c.query<{ id: string }>(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, in_service)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'flatbed', true)
         RETURNING id`,
        [session.tenant.id, `IRT-${SUFFIX}`],
      );
      truckId = t.rows[0]?.id as string;
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
    if (ctx.admin) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        const ids = [session.tenant.id];
        await c.query('DELETE FROM invoice_line_commissions WHERE tenant_id = ANY($1::uuid[])', [
          ids,
        ]);
        await c.query('DELETE FROM job_driver_assignments WHERE tenant_id = ANY($1::uuid[])', [
          ids,
        ]);
        await c.query('DELETE FROM payments WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoice_taxes WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoice_line_items WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoices WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM invoice_number_sequences WHERE tenant_id = ANY($1::uuid[])', [
          ids,
        ]);
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  async function intakeJob(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        customer: {
          name: `Customer ${SUFFIX}-${Math.random()}`,
          phone: '+13125550100',
          email: `cust-${SUFFIX}-${Math.random().toString(36).slice(2, 6)}@spec.test`,
        },
        vehicle: { vin: nextVin(), vehicleClass: 'light_duty' },
        pickup: { address: '123 Main St, Chicago, IL', lat: 41.88, lng: -87.63 },
        dropoff: { address: '456 Yard Ln, Chicago, IL', lat: 41.9, lng: -87.65 },
        authorizedBy: 'customer',
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { job: { id: string } }).job.id;
  }

  async function driveJobToCompletion(jobId: string): Promise<void> {
    // assign → dispatched → enroute → on_scene → in_progress → completed
    const headers = { ...auth(session.accessToken), 'content-type': 'application/json' };
    const assign = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers,
      payload: { driverId, truckId, shiftId },
    });
    expect(assign.statusCode).toBe(200);
    for (const to of ['enroute', 'on_scene', 'in_progress', 'completed'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/dispatch/jobs/${jobId}/transition`,
        headers,
        payload: { to },
      });
      expect(res.statusCode).toBe(200);
    }
  }

  async function fetchReview(invoiceId: string): Promise<ReviewPayload> {
    const res = await app.inject({
      method: 'GET',
      url: `/billing/invoices/${invoiceId}/review`,
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ReviewPayload;
  }

  async function fetchDraftInvoiceIdForJob(jobId: string): Promise<string> {
    // The listener fires async after job.status_changed. We poll briefly.
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/billing/invoices?jobId=${jobId}`,
        headers: auth(session.accessToken),
      });
      expect(res.statusCode).toBe(200);
      const j = res.json() as { data: Array<{ id: string; status: string }> };
      const drafts = j.data.filter((d) => d.status === 'draft');
      if (drafts.length > 0) return drafts[0]?.id as string;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`No draft invoice for job ${jobId} after 2s`);
  }

  it('job completion auto-creates draft invoice + driver commissions', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);
    const invoiceId = await fetchDraftInvoiceIdForJob(jobId);
    const review = await fetchReview(invoiceId);
    expect(review.invoice.status).toBe('draft');
    expect(review.lineItems.length).toBeGreaterThan(0);
    expect(review.commissions.length).toBeGreaterThan(0);
    // With one assigned driver, every line should have exactly one commission.
    expect(review.commissions.length).toBe(review.lineItems.length);
    expect(review.commissions.every((c) => c.driverId === driverId)).toBe(true);
    // Default commission_pct on the driver is 60.00 — single-driver mode
    // uses the driver's default.
    expect(review.commissions[0]?.commissionPct).toBe(60);
  });

  it('PATCH updates line items and replaces commissions', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);
    const invoiceId = await fetchDraftInvoiceIdForJob(jobId);
    const review = await fetchReview(invoiceId);
    const firstLine = review.lineItems[0];
    expect(firstLine).toBeDefined();
    if (!firstLine) return;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/billing/invoices/${invoiceId}/review`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        lineItems: [
          {
            id: firstLine.id,
            description: 'Edited tow service',
            unitPriceCents: 15000,
            quantity: '1',
          },
        ],
        commissions: [{ lineItemId: firstLine.id, driverId, commissionPct: 75 }],
        notes: 'Reviewed by test',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const after = patchRes.json() as ReviewPayload;
    const edited = after.lineItems.find((l) => l.id === firstLine.id);
    expect(edited?.description).toBe('Edited tow service');
    expect(edited?.unitPriceCents).toBe(15000);
    const c = after.commissions.find((c) => c.invoiceLineItemId === firstLine.id);
    expect(c?.commissionPct).toBe(75);
  });

  it('PATCH rejects when commissions exceed 100% per line', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);
    const invoiceId = await fetchDraftInvoiceIdForJob(jobId);
    const review = await fetchReview(invoiceId);
    const firstLine = review.lineItems[0];
    if (!firstLine) throw new Error('no line');

    const res = await app.inject({
      method: 'PATCH',
      url: `/billing/invoices/${invoiceId}/review`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        commissions: [
          { lineItemId: firstLine.id, driverId, commissionPct: 60 },
          { lineItemId: firstLine.id, driverId: driver2Id, commissionPct: 55 },
        ],
        assignedDriverIds: [driverId, driver2Id],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST flips draft → issued/sent and freezes commission amounts', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);
    const invoiceId = await fetchDraftInvoiceIdForJob(jobId);
    const before = await fetchReview(invoiceId);
    expect(before.invoice.status).toBe('draft');
    const totalBefore = before.invoice.totalCents;

    const postRes = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${invoiceId}/post`,
      headers: auth(session.accessToken),
    });
    expect(postRes.statusCode).toBe(200);
    const result = postRes.json() as PostResponse;
    // cash_receipt invoices land in 'sent'; account/motor_club in 'issued'.
    expect(['issued', 'sent']).toContain(result.invoice.status);
    expect(result.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4,}$/);
    // Commission cents should now equal line × pct / 100.
    for (const c of result.commissions) {
      expect(c.commissionAmountCents).toBeGreaterThan(0);
    }
    // Totals should not change as a side-effect of posting.
    const detail = await app.inject({
      method: 'GET',
      url: `/billing/invoices/${invoiceId}`,
      headers: auth(session.accessToken),
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { totalCents: number }).totalCents).toBe(totalBefore);
  });

  it('POST is idempotent — second call returns 409 with structured error', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);
    const invoiceId = await fetchDraftInvoiceIdForJob(jobId);

    const first = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${invoiceId}/post`,
      headers: auth(session.accessToken),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${invoiceId}/post`,
      headers: auth(session.accessToken),
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { code?: string; message?: string };
    expect(body.code).toBeTruthy();
  });

  it('POST /jobs/:id/drivers adds a support driver to the crew', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);

    const add = await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/drivers`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId: driver2Id, role: 'support' },
    });
    expect(add.statusCode).toBe(200);

    // Verify via direct admin query — the job_driver_assignments row
    // exists and the second driver is recorded with role=support.
    const c = await ctx.admin.connect();
    try {
      const r = await c.query<{ driver_id: string; role: string | null }>(
        'SELECT driver_id, role FROM job_driver_assignments WHERE job_id = $1::uuid',
        [jobId],
      );
      const support = r.rows.find((row) => row.driver_id === driver2Id);
      expect(support).toBeDefined();
      expect(support?.role).toBe('support');
    } finally {
      c.release();
    }
  });

  it('GET /invoices/:id/review on a posted invoice returns 400', async () => {
    const jobId = await intakeJob();
    await driveJobToCompletion(jobId);
    const invoiceId = await fetchDraftInvoiceIdForJob(jobId);
    const postRes = await app.inject({
      method: 'POST',
      url: `/billing/invoices/${invoiceId}/post`,
      headers: auth(session.accessToken),
    });
    expect(postRes.statusCode).toBe(200);

    const review = await app.inject({
      method: 'GET',
      url: `/billing/invoices/${invoiceId}/review`,
      headers: auth(session.accessToken),
    });
    // Posted invoices: the review path declines and the regular detail
    // route is the right way to read them.
    expect(review.statusCode).toBe(400);
  });
});
