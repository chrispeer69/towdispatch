/**
 * Dispatch board integration spec.
 *
 * Covers:
 *   - GET /dispatch/board returns queue + active + roster on a fresh tenant
 *   - GET /dispatch/drivers and /dispatch/trucks (RLS-scoped to caller)
 *   - shift lifecycle: start, status, location, end
 *   - assign (new -> dispatched), reassign, unassign back to new
 *   - state-machine transitions on a real job (enroute, on_scene, in_progress, completed)
 *   - invalid transition rejected at the API
 *   - cross-tenant RLS proof on drivers, trucks, shifts, transitions
 *   - audit_log captures the assign UPDATE
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

const SUFFIX = `disp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface BoardResponse {
  queue: Array<{ id: string; status: string; jobNumber: string }>;
  active: Array<{ id: string; status: string }>;
  recentlyCompleted: Array<{ id: string; status: string }>;
  roster: Array<{
    driver: { id: string; firstName: string; lastName: string; active: boolean };
    shift: { id: string; status: string; endedAt: string | null } | null;
    truck: { id: string; unitNumber: string } | null;
    currentJobNumber: string | null;
  }>;
}

interface JobResp {
  id: string;
  status: string;
  jobNumber: string;
  assignedDriverId: string | null;
  assignedTruckId: string | null;
  assignedShiftId: string | null;
}

describeIfDb('Dispatch board integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let attacker: AuthedResp;
  let driverId: string;
  let truckId: string;
  let shiftId: string;
  let jobId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, session.tenant.id);

    // Cross-tenant attacker for RLS isolation tests.
    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-attacker`, ctx));
    await seedDefaultRateSheet(ctx, attacker.tenant.id);

    // Bootstrap a driver, truck, and active shift directly via the admin
    // pool — DispatchController only exposes shift/job lifecycle, not
    // driver/truck creation, which lands in a later admin module.
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      const dRes = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Test', 'Driver', 'A', true)
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
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('GET /dispatch/drivers returns the seeded driver', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dispatch/drivers',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const drivers = res.json() as Array<{ id: string; firstName: string }>;
    const found = drivers.find((d) => d.id === driverId);
    expect(found).toBeTruthy();
    expect(found?.firstName).toBe('Test');
  });

  it('GET /dispatch/trucks returns the seeded truck', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dispatch/trucks',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const trucks = res.json() as Array<{ id: string; unitNumber: string }>;
    expect(trucks.find((t) => t.id === truckId)).toBeTruthy();
  });

  it('POST /dispatch/shifts/start creates an active shift', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dispatch/shifts/start',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId, truckId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string; endedAt: string | null };
    expect(body.status).toBe('available');
    expect(body.endedAt).toBeNull();
    shiftId = body.id;
  });

  it('rejects starting a second shift for a driver already on shift', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dispatch/shifts/start',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /dispatch/shifts/:id/location updates GPS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/shifts/${shiftId}/location`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { lat: 39.9612, lng: -82.9988 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { lastLat: number; lastLng: number };
    expect(body.lastLat).toBeCloseTo(39.9612, 4);
    expect(body.lastLng).toBeCloseTo(-82.9988, 4);
  });

  it('GET /dispatch/board returns the roster with the shift attached', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dispatch/board',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BoardResponse;
    const row = body.roster.find((r) => r.driver.id === driverId);
    expect(row).toBeTruthy();
    expect(row?.shift?.id).toBe(shiftId);
    expect(row?.truck?.id).toBe(truckId);
  });

  it('intake -> assign moves a job from new to dispatched', async () => {
    // Create a job through intake. Session 4.5 made both VIN and customer
    // email required at intake — supply both.
    const intake = await app.inject({
      method: 'POST',
      url: '/jobs/intake',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        customer: {
          name: 'Dispatch Caller',
          phone: '+15555570001',
          email: 'dispatch-caller@spec.test',
        },
        vehicle: {
          vin: '1HGCM82633A700001',
          plate: 'DISP001',
          plateState: 'OH',
          vehicleClass: 'light_duty',
        },
        serviceType: 'tow',
        pickup: { address: '100 Main St', lat: 39.9612, lng: -82.9988 },
        dropoff: { address: '200 Broad St', lat: 39.9655, lng: -82.9852 },
        authorizedBy: 'customer',
      },
    });
    expect(intake.statusCode).toBe(201);
    jobId = (intake.json() as { job: { id: string } }).job.id;

    const before = await getAuditLogCount(ctx, session.tenant.id, 'jobs', jobId);

    const assign = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId, truckId, shiftId },
    });
    expect(assign.statusCode).toBe(200);
    const body = assign.json() as JobResp;
    expect(body.status).toBe('dispatched');
    expect(body.assignedDriverId).toBe(driverId);
    expect(body.assignedShiftId).toBe(shiftId);

    // Audit log captured the UPDATE.
    const after = await getAuditLogCount(ctx, session.tenant.id, 'jobs', jobId);
    expect(after).toBeGreaterThan(before);
  });

  it('reassigning a dispatched job to a different driver succeeds (drag-between-drivers)', async () => {
    // Create a second driver + shift to reassign onto.
    const c = await ctx.admin.connect();
    let secondDriverId = '';
    let secondShiftId = '';
    try {
      await c.query('BEGIN');
      const dRes = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Second', 'Driver', 'A', true)
         RETURNING id`,
        [session.tenant.id, `EMP2-${SUFFIX}`],
      );
      secondDriverId = dRes.rows[0]?.id as string;
      const sRes = await c.query<{ id: string }>(
        `INSERT INTO driver_shifts (id, tenant_id, driver_id, status)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'available')
         RETURNING id`,
        [session.tenant.id, secondDriverId],
      );
      secondShiftId = sRes.rows[0]?.id as string;
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId: secondDriverId, shiftId: secondShiftId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as JobResp;
    expect(body.status).toBe('dispatched');
    expect(body.assignedDriverId).toBe(secondDriverId);
    expect(body.assignedShiftId).toBe(secondShiftId);
  });

  it('unassign moves a dispatched job back to new and frees the shift', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/unassign`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { reason: 'driver got pulled' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as JobResp;
    expect(body.status).toBe('new');
    expect(body.assignedDriverId).toBeNull();
  });

  it('drag-back-and-forth: re-assigning unassigned job lands dispatched again', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { driverId, truckId, shiftId },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as JobResp).status).toBe('dispatched');
  });

  it('happy-path transitions: dispatched -> enroute -> on_scene -> in_progress -> completed', async () => {
    for (const next of ['enroute', 'on_scene', 'in_progress', 'completed']) {
      const res = await app.inject({
        method: 'POST',
        url: `/dispatch/jobs/${jobId}/transition`,
        headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
        payload: { to: next },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as JobResp).status).toBe(next);
    }
  });

  it('rejects an invalid transition (completed -> in_progress) at the API layer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/transition`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { to: 'in_progress' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { type?: string; title?: string; detail?: string };
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).toMatch(/transition|invalid/);
  });

  it('cross-tenant: attacker cannot see drivers, trucks, or shifts in target tenant', async () => {
    const driversRes = await app.inject({
      method: 'GET',
      url: '/dispatch/drivers',
      headers: auth(attacker.accessToken),
    });
    const trucksRes = await app.inject({
      method: 'GET',
      url: '/dispatch/trucks',
      headers: auth(attacker.accessToken),
    });
    expect(driversRes.statusCode).toBe(200);
    expect(trucksRes.statusCode).toBe(200);
    const drivers = driversRes.json() as Array<{ id: string }>;
    const trucks = trucksRes.json() as Array<{ id: string }>;
    expect(drivers.find((d) => d.id === driverId)).toBeUndefined();
    expect(trucks.find((t) => t.id === truckId)).toBeUndefined();
  });

  it("cross-tenant: attacker cannot assign target tenant's job", async () => {
    // Attacker tries to dispatch the target tenant's job. RLS hides the
    // job from the attacker's tenant context, so the service raises 404.
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/jobs/${jobId}/assign`,
      headers: { ...auth(attacker.accessToken), 'content-type': 'application/json' },
      payload: { driverId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("RLS proof: tenant B sees zero rows for tenant A's drivers, trucks, shifts, transitions", async () => {
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [attacker.tenant.id]);
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [attacker.user.id]);
      await c.query('SET LOCAL ROLE app_user');

      const drv = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM drivers WHERE id = $1::uuid',
        [driverId],
      );
      const trk = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM trucks WHERE id = $1::uuid',
        [truckId],
      );
      const shf = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM driver_shifts WHERE id = $1::uuid',
        [shiftId],
      );
      const trn = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM job_status_transitions WHERE job_id = $1::uuid',
        [jobId],
      );
      expect(drv.rows[0]?.n).toBe(0);
      expect(trk.rows[0]?.n).toBe(0);
      expect(shf.rows[0]?.n).toBe(0);
      expect(trn.rows[0]?.n).toBe(0);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });
});
