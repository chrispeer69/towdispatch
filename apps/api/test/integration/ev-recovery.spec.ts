/**
 * Integration tests for EV Recovery (Session 48) — drives the real HTTP
 * surface against the docker stack (Postgres + Redis). Covers:
 *   - mark a job EV → intake → conservative flatbed-only equipment + the
 *     matched OEM procedure,
 *   - report a thermal event → the escalation matrix surfaces (venting → full
 *     response) and the attributes row flips thermalEventObserved,
 *   - OEM procedure lookup with model/year matching,
 *   - a charge-stop log.
 *
 * Jobs are seeded directly via the admin pool (the operator jobs-intake flow
 * needs a customer/vehicle and is out of scope here). DB-gated via skipIfNoDb;
 * cleans up its own ev + job rows before tearDown (tenant ON DELETE RESTRICT).
 */
import { uuidv7 } from '@ustowdispatch/db';
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

const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — ev recovery', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let tenantId: string;
  let token: string;
  const tenantIds: string[] = [];

  function inject(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  async function seedJob(intowMiles?: number): Promise<string> {
    const id = uuidv7();
    const c = await ctx.admin.connect();
    try {
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by, intow_miles)
         VALUES ($1, $2, $3, 'tow', '1 Main St', 'customer', $4)`,
        [id, tenantId, `EV-${Date.now()}-${Math.floor(Math.random() * 1000)}`, intowMiles ?? null],
      );
    } finally {
      c.release();
    }
    return id;
  }

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('ev', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    tenantIds.push(tenantId);
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const table of [
          'ev_thermal_events',
          'ev_charge_station_visits',
          'ev_job_attributes',
          'jobs',
        ]) {
          await c.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('seeds the OEM procedure reference (15+ EVs)', async () => {
    const res = await inject('GET', '/ev-recovery/oem-procedures');
    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json() as Array<{ make: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.some((r) => r.make === 'Tesla')).toBe(true);
  });

  it('looks up an OEM procedure by make/model/year', async () => {
    const res = await inject(
      'GET',
      '/ev-recovery/oem-procedures/lookup?make=Tesla&model=Model%203&year=2022',
    );
    expect(res.statusCode, res.body).toBe(200);
    const proc = res.json() as { make: string; model: string; towModeSteps: string } | null;
    expect(proc?.make).toBe('Tesla');
    expect(proc?.model).toBe('Model 3');
    expect(proc?.towModeSteps.toLowerCase()).toContain('flatbed');
  });

  it('marks a Tesla job EV → flatbed-only equipment + matched OEM procedure', async () => {
    const jobId = await seedJob(2);
    const res = await inject('POST', `/ev-recovery/jobs/${jobId}`, {
      make: 'Tesla',
      model: 'Model Y',
      modelYear: 2023,
      batteryChemistry: 'li_ion',
      stateOfChargePct: 40,
    });
    expect(res.statusCode, res.body).toBe(201);
    const detail = res.json() as {
      attributes: { make: string; stateOfChargePct: number };
      equipment: { flatbedRequired: boolean; dolliesAllowed: boolean };
      oemProcedure: { make: string } | null;
    };
    expect(detail.attributes.make).toBe('Tesla');
    expect(detail.equipment.flatbedRequired).toBe(true);
    expect(detail.equipment.dolliesAllowed).toBe(false);
    expect(detail.oemProcedure?.make).toBe('Tesla');
  });

  it('reports a thermal event → full escalation + observed flag flips', async () => {
    const jobId = await seedJob();
    await inject('POST', `/ev-recovery/jobs/${jobId}`, { make: 'Tesla', model: 'Model 3' });

    const res = await inject('POST', `/ev-recovery/jobs/${jobId}/thermal-events`, {
      severity: 'venting',
      actionTaken: 'Backed off, called 911',
      fireDeptCalled: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const detail = res.json() as {
      attributes: { thermalEventObserved: boolean };
      equipment: { hvIsolationRequired: boolean };
      thermalEvents: Array<{
        severity: string;
        escalation: { evacRequired: boolean; hazmatNotify: boolean };
      }>;
    };
    expect(detail.attributes.thermalEventObserved).toBe(true);
    expect(detail.equipment.hvIsolationRequired).toBe(true);
    expect(detail.thermalEvents).toHaveLength(1);
    expect(detail.thermalEvents[0]?.severity).toBe('venting');
    expect(detail.thermalEvents[0]?.escalation.evacRequired).toBe(true);
    expect(detail.thermalEvents[0]?.escalation.hazmatNotify).toBe(true);
  });

  it('logs a charge stop on a job', async () => {
    const jobId = await seedJob();
    await inject('POST', `/ev-recovery/jobs/${jobId}`, { make: 'Rivian', model: 'R1T' });
    const res = await inject('POST', `/ev-recovery/jobs/${jobId}/charge-stops`, {
      stationNetwork: 'Electrify America',
      kwhDelivered: 42.5,
      costCents: 1800,
      paidBy: 'tenant',
    });
    expect(res.statusCode, res.body).toBe(201);
    const detail = res.json() as { chargeStops: Array<{ kwhDelivered: number; paidBy: string }> };
    expect(detail.chargeStops).toHaveLength(1);
    expect(detail.chargeStops[0]?.kwhDelivered).toBe(42.5);
    expect(detail.chargeStops[0]?.paidBy).toBe('tenant');
  });

  it('returns 404 for EV detail on a job that was never marked EV', async () => {
    const jobId = await seedJob();
    const res = await inject('GET', `/ev-recovery/jobs/${jobId}`);
    expect(res.statusCode).toBe(404);
  });
});
