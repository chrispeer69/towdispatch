import { uuidv7 } from '@ustowdispatch/db';
/**
 * Integration tests for the Heavy-Duty Specialist (Session 36) — drives the
 * real HTTP surface against the docker stack (Postgres + Redis). Covers the
 * full HD ticket flow:
 *   - set truck capabilities (+ trucks.heavy_duty_capable sync),
 *   - record driver certs,
 *   - mark a job HD,
 *   - eligibility filter (eligible truck + driver surface),
 *   - on-scene estimate generation (persisted),
 *   - finalize the HD invoice,
 *   - the three reports,
 *   - the observation-only cert-expiry cron.
 *
 * DB-gated via skipIfNoDb. The shared tearDown() clears the HD tables
 * (hd_rate_sheets explicitly; the three child tables FK-cascade with
 * trucks/drivers/jobs).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HeavyDutyCertExpiryCron } from '../../src/modules/heavy-duty/heavy-duty-cert-expiry.cron.js';
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

const describeIfDb = skipIfNoDb ? describe.skip : describe;
const DAY_MS = 86_400_000;

describeIfDb('integration — heavy-duty specialist', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let tenantId: string;
  let token: string;
  const truckId = uuidv7();
  const driverId = uuidv7();
  const jobId = uuidv7();

  function inject(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return ctx.app.inject({
      method,
      url,
      headers: { ...auth(token), 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('heavy-duty', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;

    // Seed the parent truck / driver / job via the admin pool (bypasses RLS).
    const stamp = Date.now();
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO trucks (id, tenant_id, unit_number) VALUES ($1, $2, $3)', [
        truckId,
        tenantId,
        `HD-${stamp}`,
      ]);
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name) VALUES ($1, $2, 'Rex', 'Recovery')`,
        [driverId, tenantId],
      );
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, $3, 'recovery', 'I-95 MM 12', 'police')`,
        [jobId, tenantId, `HDJOB-${stamp}`],
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
    await tearDown(ctx);
  });

  it('sets truck capabilities and flips trucks.heavy_duty_capable true', async () => {
    const res = await inject('PUT', `/heavy-duty/trucks/${truckId}/capabilities`, {
      gvwrClass: 8,
      hasRotator: true,
      hasUnderLift: true,
      maxRecoveryWeightLbs: 80_000,
      axleCount: 4,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().truckId).toBe(truckId);

    const c = await ctx.admin.connect();
    try {
      const r = await c.query<{ heavy_duty_capable: boolean }>(
        'SELECT heavy_duty_capable FROM trucks WHERE id = $1',
        [truckId],
      );
      expect(r.rows[0]?.heavy_duty_capable).toBe(true);
    } finally {
      c.release();
    }
  });

  it('records HD operator + CDL-A certs for the driver', async () => {
    const op = await inject('POST', `/heavy-duty/drivers/${driverId}/certifications`, {
      certType: 'hd_operator',
      verified: true,
    });
    expect(op.statusCode).toBe(201);
    expect(op.json().certType).toBe('hd_operator');

    const cdl = await inject('POST', `/heavy-duty/drivers/${driverId}/certifications`, {
      certType: 'cdl_a',
      expiresAt: '2030-01-01',
    });
    expect(cdl.statusCode).toBe(201);

    const list = await inject('GET', `/heavy-duty/drivers/${driverId}/certifications`);
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(2);
  });

  it('recording the same cert type again upserts (one live row)', async () => {
    const again = await inject('POST', `/heavy-duty/drivers/${driverId}/certifications`, {
      certType: 'hd_operator',
      expiresAt: '2031-06-01',
    });
    expect(again.statusCode).toBe(201);
    const list = await inject('GET', `/heavy-duty/drivers/${driverId}/certifications`);
    expect(list.json()).toHaveLength(2); // still 2 — hd_operator replaced, not added
  });

  it('marks the job HD (class 8, rotator + DOT report required)', async () => {
    const res = await inject('PUT', `/heavy-duty/jobs/${jobId}`, {
      vehicleClass: 8,
      vehicleGvwrLbs: 70_000,
      incidentType: 'overturn',
      cargoType: 'dry van',
      requiresRotator: true,
      requiresDotReport: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().requiresRotator).toBe(true);
  });

  it('surfaces the eligible truck + driver on the job detail', async () => {
    const res = await inject('GET', `/heavy-duty/jobs/${jobId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const truck = body.eligibleTrucks.find((t: { truckId: string }) => t.truckId === truckId);
    expect(truck?.eligible).toBe(true);

    const driver = body.eligibleDrivers.find((d: { driverId: string }) => d.driverId === driverId);
    expect(driver?.eligible).toBe(true);
  });

  it('generates + persists an on-scene estimate from a rate sheet', async () => {
    const sheet = await inject('POST', '/heavy-duty/rate-sheets', {
      name: 'Standard HD',
      hourlyRateCents: 25_000,
      hookupFeeCents: 50_000,
      rotatorPerHrCents: 75_000,
      mileageLoadedCents: 1_000,
      afterHoursMultiplier: 1.5,
    });
    expect(sheet.statusCode).toBe(201);
    const rateSheetId = sheet.json().id;

    const est = await inject('POST', `/heavy-duty/jobs/${jobId}/estimate`, {
      rateSheetId,
      laborHours: 2,
      rotatorHours: 1.5,
      loadedMiles: 30,
      includeHookup: true,
      afterHours: true,
    });
    expect(est.statusCode).toBe(201);
    const body = est.json();
    // subtotal: 50000 + 2*25000 + 1.5*75000 + 30*1000 = 50000+50000+112500+30000 = 242500
    expect(body.subtotalCents).toBe(242_500);
    expect(body.multiplier).toBe(1.5);
    expect(body.totalCents).toBe(363_750);

    const attrs = await inject('GET', `/heavy-duty/jobs/${jobId}/attributes`);
    expect(attrs.json().onSceneEstimateCents).toBe(363_750);
  });

  it('finalizes the HD invoice', async () => {
    const res = await inject('POST', `/heavy-duty/jobs/${jobId}/finalize`, {
      finalInvoiceCents: 380_000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().finalInvoiceCents).toBe(380_000);
  });

  it('reports HD jobs by month + equipment utilization', async () => {
    const byMonth = await inject('GET', '/heavy-duty/reports/jobs-by-month');
    expect(byMonth.statusCode).toBe(200);
    expect(byMonth.json().totalJobs).toBeGreaterThanOrEqual(1);
    expect(byMonth.json().totalRevenueCents).toBeGreaterThanOrEqual(380_000);

    const util = await inject('GET', '/heavy-duty/reports/equipment-utilization');
    expect(util.statusCode).toBe(200);
    expect(util.json().totalHdJobs).toBeGreaterThanOrEqual(1);
    expect(util.json().rotatorJobs).toBeGreaterThanOrEqual(1);
    expect(util.json().rotatorUtilizationPct).toBe(100);
  });

  it('cert-expiry roster lists a soon-to-expire cert', async () => {
    // Add a rotator cert expiring in ~10 days.
    const soon = new Date(Date.now() + 10 * DAY_MS).toISOString().slice(0, 10);
    await inject('POST', `/heavy-duty/drivers/${driverId}/certifications`, {
      certType: 'rotator',
      expiresAt: soon,
    });
    const res = await inject('GET', '/heavy-duty/reports/cert-expiry?windowDays=30');
    expect(res.statusCode).toBe(200);
    const rotatorRow = res.json().rows.find((r: { certType: string }) => r.certType === 'rotator');
    expect(rotatorRow?.status).toBe('expiring');
    expect(res.json().expiringCount).toBeGreaterThanOrEqual(1);
  });

  it('cert-expiry cron is observation-only (counts, mutates nothing)', async () => {
    const cron = ctx.app.get(HeavyDutyCertExpiryCron);
    const before = await inject('GET', `/heavy-duty/drivers/${driverId}/certifications`);
    const beforeCount = before.json().length;

    const result = await cron.tick(new Date());
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.expiringSoon).toBeGreaterThanOrEqual(1);

    // No mutation: the cert set is unchanged after the tick.
    const after = await inject('GET', `/heavy-duty/drivers/${driverId}/certifications`);
    expect(after.json().length).toBe(beforeCount);
  });
});
