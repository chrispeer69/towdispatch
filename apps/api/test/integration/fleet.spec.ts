import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

const SUFFIX = `fleet-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Fleet integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let attacker: AuthedResp;
  const created: { truckIds: string[]; driverIds: string[]; documentIds: string[] } = {
    truckIds: [],
    driverIds: [],
    documentIds: [],
  };

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-attacker`, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  // ---------------- trucks ----------------
  it('creates a truck', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/trucks',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        unitNumber: 'T-1',
        truckType: 'flatbed',
        capacityClass: 'medium',
        gvwrLbs: 26000,
        fuelType: 'diesel',
        equipment: ['flatbed', 'winch'],
        registrationExpiresAt: futureIso(45),
        insuranceExpiresAt: futureIso(5),
        currentOdometer: 50000,
        status: 'active',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; inService: boolean; status: string };
    created.truckIds.push(body.id);
    expect(body.inService).toBe(true);
    expect(body.status).toBe('active');
  });

  it('rejects a duplicate unit number for the same tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/trucks',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { unitNumber: 'T-1', truckType: 'flatbed' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('lists trucks and filters by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/trucks?status=active',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ status: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    for (const t of body.data) expect(t.status).toBe('active');
  });

  it('cross-tenant truck access is blocked by RLS', async () => {
    const truckId = created.truckIds[0] as string;
    const peek = await app.inject({
      method: 'GET',
      url: `/fleet/trucks/${truckId}`,
      headers: auth(attacker.accessToken),
    });
    expect(peek.statusCode).toBe(404);
  });

  // ---------------- drivers ----------------
  it('creates a driver', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/drivers',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        firstName: 'Mike',
        lastName: 'Smith',
        email: 'mike@spec.test',
        phone: '+15555550101',
        cdlClass: 'A',
        cdlExpiresAt: futureIso(180),
        licenseState: 'OH',
        medicalCardExpiresAt: futureIso(3),
        certifications: ['WreckMaster_4_5', 'TIM'],
        employmentStatus: 'active',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; active: boolean; cdlClass: string };
    created.driverIds.push(body.id);
    expect(body.active).toBe(true);
    expect(body.cdlClass).toBe('A');
  });

  it('cross-tenant driver list returns empty (RLS)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/drivers',
      headers: auth(attacker.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  // ---------------- default_commission_pct (Admin Settings build 3) ----------------
  it('PATCH defaultCommissionPct persists and is returned on GET', async () => {
    const id = created.driverIds[0] as string;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/fleet/drivers/${id}`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { defaultCommissionPct: 25.5 },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as { defaultCommissionPct: number | null };
    expect(patched.defaultCommissionPct).toBe(25.5);

    const get = await app.inject({
      method: 'GET',
      url: `/fleet/drivers/${id}`,
      headers: auth(session.accessToken),
    });
    expect(get.statusCode).toBe(200);
    const fetched = get.json() as { defaultCommissionPct: number | null };
    expect(fetched.defaultCommissionPct).toBe(25.5);
  });

  it('PATCH defaultCommissionPct = 150 is rejected (range)', async () => {
    const id = created.driverIds[0] as string;
    const res = await app.inject({
      method: 'PATCH',
      url: `/fleet/drivers/${id}`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { defaultCommissionPct: 150 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH defaultCommissionPct = -5 is rejected (range)', async () => {
    const id = created.driverIds[0] as string;
    const res = await app.inject({
      method: 'PATCH',
      url: `/fleet/drivers/${id}`,
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { defaultCommissionPct: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cross-tenant PATCH on a driver is blocked by RLS', async () => {
    const id = created.driverIds[0] as string;
    const res = await app.inject({
      method: 'PATCH',
      url: `/fleet/drivers/${id}`,
      headers: { ...auth(attacker.accessToken), 'content-type': 'application/json' },
      payload: { defaultCommissionPct: 99 },
    });
    expect(res.statusCode).toBe(404);
  });

  // ---------------- assignments ----------------
  it('assigns a driver to a truck', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/assignments',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        driverId: created.driverIds[0],
        truckId: created.truckIds[0],
        isPrimary: true,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  // ---------------- documents ----------------
  it('uploads a registration document with expiry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/documents',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        ownerType: 'truck',
        ownerId: created.truckIds[0],
        docType: 'registration',
        fileName: 'reg.pdf',
        mimeType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-test\n').toString('base64'),
        expiresAt: new Date(`${futureIso(20)}T00:00:00Z`).toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; fileUrl: string };
    created.documentIds.push(body.id);
    expect(body.fileUrl.startsWith(`tenants/${session.tenant.id}/`)).toBe(true);
  });

  it('cross-tenant document download is blocked', async () => {
    const docId = created.documentIds[0] as string;
    const peek = await app.inject({
      method: 'GET',
      url: `/fleet/documents/${docId}/download`,
      headers: auth(attacker.accessToken),
    });
    expect([403, 404]).toContain(peek.statusCode);
  });

  // ---------------- DVIRs ----------------
  it('submits a DVIR with no defects → status no_defects, truck stays active', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/dvirs',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        driverId: created.driverIds[0],
        truckId: created.truckIds[0],
        type: 'pre_trip',
        odometerReading: 50100,
        defects: [],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string };
    expect(body.status).toBe('no_defects');

    const truck = await app.inject({
      method: 'GET',
      url: `/fleet/trucks/${created.truckIds[0]}`,
      headers: auth(session.accessToken),
    });
    const tBody = truck.json() as { status: string; currentOdometer: number };
    expect(tBody.status).toBe('active');
    expect(tBody.currentOdometer).toBe(50100);
  });

  it('submits a DVIR with out_of_service defect → truck flips to in_maintenance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/dvirs',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        driverId: created.driverIds[0],
        truckId: created.truckIds[0],
        type: 'pre_trip',
        defects: [{ component: 'Brakes', severity: 'out_of_service', notes: 'leak' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string };
    expect(body.status).toBe('out_of_service');

    const truck = await app.inject({
      method: 'GET',
      url: `/fleet/trucks/${created.truckIds[0]}`,
      headers: auth(session.accessToken),
    });
    const tBody = truck.json() as { status: string; inService: boolean };
    expect(tBody.status).toBe('in_maintenance');
    expect(tBody.inService).toBe(false);
  });

  // ---------------- maintenance ----------------
  it('creates a mileage schedule and recomputes next_due on a record', async () => {
    const sched = await app.inject({
      method: 'POST',
      url: '/fleet/maintenance/schedules',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        truckId: created.truckIds[0],
        scheduleType: 'mileage',
        serviceType: 'oil',
        intervalMiles: 5000,
        lastServicedMiles: 50000,
      },
    });
    expect(sched.statusCode).toBe(201);
    const sBody = sched.json() as { id: string; nextDueMiles: number };
    expect(sBody.nextDueMiles).toBe(55000);

    const rec = await app.inject({
      method: 'POST',
      url: '/fleet/maintenance/records',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        truckId: created.truckIds[0],
        scheduleId: sBody.id,
        performedAt: todayIso(),
        performedMiles: 55200,
        serviceType: 'oil',
        costCents: 8900,
      },
    });
    expect(rec.statusCode).toBe(201);

    const dueList = await app.inject({
      method: 'GET',
      url: '/fleet/maintenance/due',
      headers: auth(session.accessToken),
    });
    expect(dueList.statusCode).toBe(200);
  });

  // ---------------- expirations ----------------
  it('expirations groups items by severity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/expirations?windowDays=30',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      windowDays: number;
      expired: unknown[];
      critical: unknown[];
      warning: unknown[];
    };
    expect(body.windowDays).toBe(30);
    // Truck insurance expires in 5 days → critical bucket.
    // Truck registration in 45 days → window is 30, so it should NOT appear.
    // Driver medical card in 3 days → critical.
    // Document expiry in 20 days → warning.
    expect(body.critical.length).toBeGreaterThanOrEqual(2);
    expect(body.warning.length).toBeGreaterThanOrEqual(1);
  });

  it('cross-tenant DVIR list returns empty (RLS)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fleet/dvirs?truckId=${created.truckIds[0]}`,
      headers: auth(attacker.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body).toHaveLength(0);
  });

  it('cross-tenant maintenance schedules return empty (RLS)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fleet/trucks/${created.truckIds[0]}/maintenance/schedules`,
      headers: auth(attacker.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body).toHaveLength(0);
  });

  it('cross-tenant expirations call returns empty buckets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/expirations?windowDays=30',
      headers: auth(attacker.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { expired: unknown[]; critical: unknown[]; warning: unknown[] };
    expect(body.expired).toHaveLength(0);
    expect(body.critical).toHaveLength(0);
    expect(body.warning).toHaveLength(0);
  });
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
