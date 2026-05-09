/**
 * Call-intake integration spec.
 *
 * Covers the surfaces a dispatcher exercises in 60% of their day:
 *   - find-or-create customer + vehicle in one POST
 *   - tow vs non-tow service-type branching
 *   - account-attached job vs cash job vs motor-club job
 *   - per-tenant job_number sequence
 *   - rate engine fallback path
 *   - Zod validation rejection for bad service / missing pickup
 *   - cross-tenant RLS isolation (Gate 2)
 *   - audit_log INSERT capture (Gate 5)
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  auth,
  getAuditLogCount,
  makeContext,
  makeSignupBody,
  seedDefaultRateSheet,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `job-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface JobIntakeBody {
  customer: { name: string; phone: string; email?: string };
  vehicle: {
    plate?: string;
    plateState?: string;
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
    color?: string;
    vehicleClass?: string;
  };
  serviceType: string;
  pickup: { address: string; lat?: number; lng?: number };
  dropoff?: { address: string; lat?: number; lng?: number };
  authorizedBy?: string;
  authorizedByName?: string;
  accountId?: string;
  notes?: string;
}

interface IntakeResponse {
  job: {
    id: string;
    tenantId: string;
    jobNumber: string;
    status: string;
    serviceType: string;
    customerId: string;
    vehicleId: string;
    accountId: string | null;
    pickupAddress: string;
    rateQuotedCents: number;
    rateBreakdown: { source: string; lineItems: Array<{ code: string }>; calculationTrace: string[] };
  };
  customer: { id: string; name: string; created: boolean };
  vehicle: { id: string; plate: string | null; created: boolean };
  rateQuote: {
    source: string;
    rateSheetId: string | null;
    distanceMiles: number;
    totalCents: number;
    lineItems: Array<{ code: string; amountCents: number }>;
  };
}

describeIfDb('Jobs intake integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let agentSession: AuthedResp;
  let agentTenantId: string;
  let accountId: string;
  let motorClubId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, session.tenant.id);

    // Account for non-cash jobs.
    const acctRes = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { name: 'Acme Logistics', billingTerms: 'net_30', creditLimit: '50000.00' },
    });
    accountId = (acctRes.json() as { id: string }).id;

    // Motor club account so we can drive the motor_club authorized_by case.
    const mcRes = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        name: 'Test Motor Club',
        billingTerms: 'net_30',
        isMotorClub: true,
        motorClubNetworkCode: 'TMC',
      },
    });
    motorClubId = (mcRes.json() as { id: string }).id;

    // Cross-tenant attacker for RLS test.
    agentSession = await signup(ctx, makeSignupBody(`${SUFFIX}-other`, ctx));
    agentTenantId = agentSession.tenant.id;
    await seedDefaultRateSheet(ctx, agentTenantId);
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  const baseTowIntake = (overrides: Partial<JobIntakeBody> = {}): JobIntakeBody => ({
    customer: { name: 'John Caller', phone: '+15555557001', email: 'john.caller@spec.test' },
    vehicle: {
      plate: 'JOB1234',
      plateState: 'OH',
      year: 2018,
      make: 'Honda',
      model: 'Civic',
      color: 'Blue',
      vehicleClass: 'light_duty',
    },
    serviceType: 'tow',
    pickup: { address: '100 Main St, Columbus OH', lat: 39.9612, lng: -82.9988 },
    dropoff: { address: '200 Broad St, Columbus OH', lat: 39.9655, lng: -82.9852 },
    authorizedBy: 'customer',
    ...overrides,
  });

  it('intake creates a tow job with a fresh customer and vehicle', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: baseTowIntake(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.job.id).toBeTruthy();
    expect(body.job.jobNumber).toMatch(/^[0-9]{8}-\d{4}$/);
    expect(body.job.status).toBe('new');
    expect(body.job.serviceType).toBe('tow');
    expect(body.job.tenantId).toBe(session.tenant.id);
    expect(body.customer.created).toBe(true);
    expect(body.vehicle.created).toBe(true);
    expect(body.vehicle.plate).toBe('JOB1234');
    expect(body.rateQuote.source).toBe('tenant_default');
    expect(body.rateQuote.totalCents).toBeGreaterThan(0);
    expect(body.rateQuote.distanceMiles).toBeGreaterThan(0);
    expect(body.job.rateQuotedCents).toBe(body.rateQuote.totalCents);
  });

  it('intake reuses an existing customer when the same phone is dialed again', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: baseTowIntake({
        customer: { name: 'John Caller (returning)', phone: '+15555557001' },
        vehicle: {
          plate: 'NEW2345',
          plateState: 'OH',
          year: 2020,
          make: 'Toyota',
          model: 'Camry',
          vehicleClass: 'light_duty',
        },
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.customer.created).toBe(false);
    // New vehicle still gets created.
    expect(body.vehicle.created).toBe(true);
    expect(body.vehicle.plate).toBe('NEW2345');
  });

  it('intake reuses an existing vehicle when the same plate+state is supplied', async () => {
    const intake = baseTowIntake({
      customer: { name: 'New Driver', phone: '+15555557002' },
      vehicle: {
        plate: 'JOB1234',
        plateState: 'OH',
        vehicleClass: 'light_duty',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: intake,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.customer.created).toBe(true);
    expect(body.vehicle.created).toBe(false);
    expect(body.vehicle.plate).toBe('JOB1234');
  });

  it('intake attaches a job to an account when accountId is given', async () => {
    const intake = baseTowIntake({
      customer: { name: 'Account Caller', phone: '+15555557003' },
      vehicle: { plate: 'ACCT777', plateState: 'OH', vehicleClass: 'light_duty' },
      accountId,
      authorizedBy: 'account_contact',
      authorizedByName: 'Mary AP',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: intake,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.job.accountId).toBe(accountId);
  });

  it('intake supports a cash job (no accountId)', async () => {
    const intake = baseTowIntake({
      customer: { name: 'Cash Caller', phone: '+15555557004' },
      vehicle: { plate: 'CASH123', plateState: 'OH', vehicleClass: 'light_duty' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: intake,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.job.accountId).toBeNull();
  });

  it('intake supports a motor-club authorized job', async () => {
    const intake = baseTowIntake({
      customer: { name: 'MC Caller', phone: '+15555557005' },
      vehicle: { plate: 'AGERO11', plateState: 'OH', vehicleClass: 'light_duty' },
      accountId: motorClubId,
      authorizedBy: 'motor_club',
      authorizedByName: 'Agero dispatch line',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: intake,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.job.accountId).toBe(motorClubId);
  });

  it('intake creates a non-tow service without dropoff', async () => {
    const intake: JobIntakeBody = {
      customer: { name: 'Lockout Caller', phone: '+15555557006' },
      vehicle: { plate: 'LOCK111', plateState: 'OH', vehicleClass: 'light_duty' },
      serviceType: 'lockout',
      pickup: { address: '500 High St, Columbus OH', lat: 39.96, lng: -83.0 },
      authorizedBy: 'customer',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: intake,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as IntakeResponse;
    expect(body.job.serviceType).toBe('lockout');
    expect(body.rateQuote.distanceMiles).toBe(0);
    // Lockout has no per-mile line item, so no 'mileage' code in line items.
    expect(body.rateQuote.lineItems.find((li) => li.code === 'mileage')).toBeUndefined();
  });

  it('intake rejects a tow without a dropoff', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        customer: { name: 'No Drop', phone: '+15555557007' },
        vehicle: { plate: 'NDROP1', plateState: 'OH' },
        serviceType: 'tow',
        pickup: { address: '600 Front St' },
        authorizedBy: 'customer',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('intake rejects an invalid service_type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        customer: { name: 'Bad Service', phone: '+15555557008' },
        vehicle: { plate: 'BADSVC', plateState: 'OH' },
        serviceType: 'teleport',
        pickup: { address: '700 Front St' },
        authorizedBy: 'customer',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('intake rejects when pickup is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        customer: { name: 'Empty Pickup', phone: '+15555557009' },
        vehicle: { plate: 'EMPTYP', plateState: 'OH' },
        serviceType: 'lockout',
        pickup: { address: '' },
        authorizedBy: 'customer',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cross-tenant SELECT cannot see jobs created in tenant A (RLS proof)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: baseTowIntake({
        customer: { name: 'RLS Target', phone: '+15555557090' },
        vehicle: { plate: 'RLSCANT', plateState: 'OH', vehicleClass: 'light_duty' },
      }),
    });
    expect(created.statusCode).toBe(201);
    const targetJobId = (created.json() as IntakeResponse).job.id;

    // Tenant B tries to read tenant A's job by id — RLS must hide it.
    const peek = await app.inject({
      method: 'GET',
      url: `/jobs/${targetJobId}`,
      headers: auth(agentSession.accessToken),
    });
    expect(peek.statusCode).toBe(404);

    // Direct DB confirmation: SELECT under tenant B's GUC must return zero rows.
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [agentTenantId]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [agentSession.user.id]);
      // Use app_user role within transaction to enforce RLS (admin bypasses unless we switch).
      await c.query("SET LOCAL ROLE app_user");
      const r = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM jobs WHERE id = $1::uuid',
        [targetJobId],
      );
      expect(r.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  it('quote-preview returns a quote without persisting anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.9612, lng: -82.9988 },
        dropoff: { address: 'b', lat: 39.9655, lng: -82.9852 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { totalCents: number; lineItems: Array<{ code: string }>; source: string };
    expect(body.totalCents).toBeGreaterThan(0);
    expect(body.source).toBe('tenant_default');
    expect(body.lineItems.find((li) => li.code === 'base')).toBeTruthy();
  });

  it('rate engine falls back when tenant has no default rate sheet', async () => {
    // Brand-new tenant with no seed — engine must still return a quote
    // using the hard-coded fallback.
    const orphan = await signup(ctx, makeSignupBody(`${SUFFIX}-orphan`, ctx));
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/quote-preview',
      headers: { ...auth(orphan.accessToken), 'content-type': 'application/json' },
      payload: {
        serviceType: 'tow',
        vehicleClass: 'light_duty',
        pickup: { address: 'a', lat: 39.9612, lng: -82.9988 },
        dropoff: { address: 'b', lat: 39.9655, lng: -82.9852 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { totalCents: number; source: string; rateSheetId: string | null };
    expect(body.source).toBe('fallback');
    expect(body.rateSheetId).toBeNull();
    expect(body.totalCents).toBeGreaterThan(0);
  });

  it('audit_log captures the job INSERT (Gate 5)', async () => {
    const before = await getAuditLogCount(ctx, session.tenant.id, 'jobs');
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: baseTowIntake({
        customer: { name: 'Audit Target', phone: '+15555557099' },
        vehicle: { plate: 'AUDIT11', plateState: 'OH', vehicleClass: 'light_duty' },
      }),
    });
    expect(res.statusCode).toBe(201);
    const jobId = (res.json() as IntakeResponse).job.id;
    const after = await getAuditLogCount(ctx, session.tenant.id, 'jobs', jobId);
    expect(after).toBeGreaterThanOrEqual(1);
    expect(await getAuditLogCount(ctx, session.tenant.id, 'jobs')).toBeGreaterThan(before);
  });

  it('cancel transitions a new job to cancelled with a reason', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: baseTowIntake({
        customer: { name: 'Cancel Target', phone: '+15555557100' },
        vehicle: { plate: 'CANCEL1', plateState: 'OH', vehicleClass: 'light_duty' },
      }),
    });
    expect(created.statusCode).toBe(201);
    const jobId = (created.json() as IntakeResponse).job.id;

    const cancel = await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/cancel`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { reason: 'Caller hung up' },
    });
    expect(cancel.statusCode).toBe(200);
    const body = cancel.json() as { status: string; cancelledReason: string };
    expect(body.status).toBe('cancelled');
    expect(body.cancelledReason).toBe('Caller hung up');
  });
});
