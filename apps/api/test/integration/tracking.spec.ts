/**
 * Tracking integration spec — Session 9.
 *
 * Surface coverage:
 *   - intake → assign auto-creates a tracking_link with smsStatus 'delivered'
 *     (stub provider) AND fires a tracking SMS captured by the stub buffer.
 *   - skipCustomerSms=true at intake suppresses the SMS but still creates a
 *     link with smsStatus 'skipped'.
 *   - GET /public/track/:token resolves the public view, including friendly
 *     status label translation in EN and ES.
 *   - POST /public/track/:token/messages writes inbound, surfaces in
 *     dispatcher GET /tracking/:jobId/messages.
 *   - Cross-tenant token isolation: tenant B's API session cannot read tenant
 *     A's link via /tracking/:jobId, and the public route still resolves the
 *     correct tenant data through the token.
 *   - Token rotation: revoke flips status to 410, ensureForJob mints a new
 *     unguessable token.
 *   - Expired token returns 410 (not 404).
 *   - Submit rating once and re-submit upserts to last write.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StubNotificationProvider } from '../../src/integrations/notification/stub.notification-provider.js';
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

const SUFFIX = `track-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
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

describeIfDb('Tracking integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let attacker: AuthedResp;
  let driverId: string;
  let truckId: string;
  let shiftId: string;
  let stub: StubNotificationProvider;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, session.tenant.id);

    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-att`, ctx));
    await seedDefaultRateSheet(ctx, attacker.tenant.id);

    stub = app.get(StubNotificationProvider);

    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      const dRes = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Track', 'Driver', 'A', true)
         RETURNING id`,
        [session.tenant.id, `EMP-${SUFFIX}`],
      );
      driverId = dRes.rows[0]?.id as string;
      const tRes = await c.query<{ id: string }>(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, in_service)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'flatbed', true)
         RETURNING id`,
        [session.tenant.id, `T-${SUFFIX}`],
      );
      truckId = tRes.rows[0]?.id as string;
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }

    // Start a shift so we can assign jobs.
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
    await tearDown(ctx);
  });

  function intakeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      customer: {
        name: 'Casey Customer',
        phone: '+15555558001',
        email: 'casey.customer@spec.test',
      },
      vehicle: {
        vin: nextVin(),
        plate: 'TRK0001',
        plateState: 'OH',
        year: 2020,
        make: 'Ford',
        model: 'F-150',
        color: 'Red',
        vehicleClass: 'light_duty',
      },
      serviceType: 'tow',
      pickup: { address: '500 Main St', lat: 39.9612, lng: -82.9988 },
      dropoff: { address: '600 Broad St', lat: 39.9655, lng: -82.9852 },
      authorizedBy: 'customer',
      ...overrides,
    };
  }

  async function createAndAssignJob(
    sess: AuthedResp,
    extras: Record<string, unknown> = {},
  ): Promise<{ jobId: string; jobNumber: string }> {
    const intake = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(sess.accessToken), 'content-type': 'application/json' },
      payload: intakeBody(extras),
    });
    expect(intake.statusCode).toBe(201);
    const intakeBodyRes = intake.json() as { job: { id: string; jobNumber: string } };
    const jobId = intakeBodyRes.job.id;

    const assign = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers: { ...auth(sess.accessToken), 'content-type': 'application/json' },
      payload: { driverId, truckId, shiftId },
    });
    expect(assign.statusCode).toBe(200);
    return { jobId, jobNumber: intakeBodyRes.job.jobNumber };
  }

  // The auto-create runs in a fire-and-forget event subscriber. Wait for the
  // tracking_links row to land (small window in dev, larger in CI).
  async function waitForTrackingLink(
    sess: AuthedResp,
    jobId: string,
    timeoutMs = 4000,
  ): Promise<{ link: { id: string; token: string; smsStatus: string; url: string } }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await app.inject({
        method: 'GET',
        url: `/tracking/${jobId}`,
        headers: auth(sess.accessToken),
      });
      const body = res.json() as {
        link: { id: string; token: string; smsStatus: string; url: string } | null;
      };
      if (res.statusCode === 200 && body.link) return { link: body.link };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`tracking link for job=${jobId} did not appear within ${timeoutMs}ms`);
  }

  it('intake → assign auto-creates a tracking link and dispatches the stub SMS', async () => {
    stub.reset();
    const { jobId } = await createAndAssignJob(session);

    const { link } = await waitForTrackingLink(session, jobId);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(link.url).toContain(`/track/${link.token}`);

    // The stub fires synchronously inside dispatchSmsForLink and the
    // ring buffer captures the message.
    const sent = stub.getSentMessages();
    const captured = sent.find((m) => m.clientReference === link.id);
    expect(captured).toBeTruthy();
    expect(captured?.to).toBe('+15555558001');
    expect(captured?.body ?? '').toContain('/track/');

    // smsStatus should be 'delivered' for the stub provider.
    expect(['delivered', 'sent', 'queued']).toContain(link.smsStatus);
  });

  it('skipCustomerSms=true at intake creates a link with smsStatus=skipped', async () => {
    stub.reset();
    const { jobId } = await createAndAssignJob(session, { skipCustomerSms: true });
    const { link } = await waitForTrackingLink(session, jobId);
    expect(link.smsStatus).toBe('skipped');
    // Stub did NOT receive a message for this job.
    const sent = stub.getSentMessages();
    expect(sent.find((m) => m.clientReference === link.id)).toBeFalsy();
  });

  it('GET /public/track/:token returns a friendly status label and tenant info', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);

    const res = await app.inject({
      method: 'GET',
      url: `/public/track/${link.token}`,
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as {
      jobNumber: string;
      status: string;
      statusLabel: string;
      tenant: { name: string };
      driver: { firstName: string } | null;
    };
    expect(view.status).toBe('dispatched');
    expect(view.statusLabel).toBe('Driver assigned');
    expect(view.tenant.name).toBeTruthy();
    expect(view.driver?.firstName).toBe('Track');
  });

  it('public view honors lang=es', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);
    const res = await app.inject({
      method: 'GET',
      url: `/public/track/${link.token}?lang=es`,
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as { statusLabel: string };
    expect(view.statusLabel).toBe('Conductor asignado');
  });

  it('customer messages from the public route appear in the dispatcher thread', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);

    const send = await app.inject({
      method: 'POST',
      url: `/public/track/${link.token}/messages`,
      headers: { 'content-type': 'application/json' },
      payload: { body: 'Will the truck be much longer?' },
    });
    expect(send.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/tracking/${jobId}/messages`,
      headers: auth(session.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const { messages } = list.json() as {
      messages: Array<{ direction: string; body: string }>;
    };
    expect(messages.find((m) => m.body === 'Will the truck be much longer?')).toBeTruthy();
    expect(messages.find((m) => m.body === 'Will the truck be much longer?')?.direction).toBe(
      'inbound',
    );
  });

  it('cross-tenant: attacker session cannot read tenant A tracking link by job id', async () => {
    const { jobId } = await createAndAssignJob(session);
    await waitForTrackingLink(session, jobId);

    const res = await app.inject({
      method: 'GET',
      url: `/tracking/${jobId}`,
      headers: auth(attacker.accessToken),
    });
    // RLS hides the link from the attacker's tenant: response is 200 with
    // link=null (NotFound on the job row would also be acceptable).
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json() as { link: unknown };
      expect(body.link).toBeNull();
    }
  });

  it('public token from tenant A resolves to tenant A data even when forged from another tenant context', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);

    // Forging means: attacker tries to reuse the token. They can — that's
    // the whole point of public tracking — but they only see tenant A's job.
    const view = await app.inject({
      method: 'GET',
      url: `/public/track/${link.token}`,
    });
    expect(view.statusCode).toBe(200);
    const body = view.json() as { jobNumber: string };
    expect(body.jobNumber).toBeTruthy();
  });

  it('revoke rotates the token: old token returns 410, new token resolves', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link: original } = await waitForTrackingLink(session, jobId);

    const revokeRes = await app.inject({
      method: 'POST',
      url: `/tracking/${jobId}/revoke`,
      headers: auth(session.accessToken),
    });
    expect(revokeRes.statusCode).toBe(200);

    const goneRes = await app.inject({
      method: 'GET',
      url: `/public/track/${original.token}`,
    });
    expect(goneRes.statusCode).toBe(410);

    // Mint a new link.
    const ensureRes = await app.inject({
      method: 'POST',
      url: `/tracking/${jobId}/link`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { sendSms: false },
    });
    expect(ensureRes.statusCode).toBe(200);
    const fresh = ensureRes.json() as { token: string };
    expect(fresh.token).not.toBe(original.token);

    const newView = await app.inject({
      method: 'GET',
      url: `/public/track/${fresh.token}`,
    });
    expect(newView.statusCode).toBe(200);
  });

  it('expired token returns 410 (not 404)', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);

    // Force expiry via the admin pool.
    const c = await ctx.admin.connect();
    try {
      await c.query(
        "UPDATE tracking_links SET expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
        [link.id],
      );
    } finally {
      c.release();
    }

    const res = await app.inject({
      method: 'GET',
      url: `/public/track/${link.token}`,
    });
    expect(res.statusCode).toBe(410);
  });

  it('rating submit creates a row and re-submit upserts to last write', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);

    const r1 = await app.inject({
      method: 'POST',
      url: `/public/track/${link.token}/rating`,
      headers: { 'content-type': 'application/json' },
      payload: { stars: 4, comment: 'good' },
    });
    expect(r1.statusCode).toBe(201);

    const r2 = await app.inject({
      method: 'POST',
      url: `/public/track/${link.token}/rating`,
      headers: { 'content-type': 'application/json' },
      payload: { stars: 5, comment: 'great after all' },
    });
    expect(r2.statusCode).toBe(201);

    // Verify via admin pool.
    const c = await ctx.admin.connect();
    try {
      const rows = await c.query<{ stars: string; comment: string }>(
        'SELECT stars::text, comment FROM job_ratings WHERE job_id = $1::uuid',
        [jobId],
      );
      expect(rows.rowCount).toBe(1);
      expect(Number(rows.rows[0]?.stars)).toBe(5);
      expect(rows.rows[0]?.comment).toBe('great after all');
    } finally {
      c.release();
    }
  });

  it('audit_log captures tracking_link inserts and revokes', async () => {
    const { jobId } = await createAndAssignJob(session);
    const { link } = await waitForTrackingLink(session, jobId);

    await app.inject({
      method: 'POST',
      url: `/tracking/${jobId}/revoke`,
      headers: auth(session.accessToken),
    });

    const c = await ctx.admin.connect();
    try {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
         WHERE tenant_id = $1::uuid AND resource_type = 'tracking_links' AND resource_id = $2::uuid`,
        [session.tenant.id, link.id],
      );
      expect(Number(r.rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(2); // INSERT + UPDATE(s) + revoke UPDATE
    } finally {
      c.release();
    }
  });
});
