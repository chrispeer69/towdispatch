/**
 * Integration — Full DOT Compliance (Session 37). DB-gated (self-skips
 * without Postgres/Redis). Drives the real Nest app via inject():
 *   carrier profile → HOS week with a violation → audit packet PDF →
 *   drug test → DOT-recordable incident → DQ event → expiry cron.
 */
import { uuidv7 } from '@ustowdispatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DotExpiryCron } from '../../src/modules/dot/dot-expiry.cron.js';
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
const isoDate = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describeIfDb('integration — DOT compliance', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let tenantId: string;
  let token: string;
  const driverId = uuidv7();
  const tenantIds: string[] = [];

  function inject(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
    owner = await signup(ctx, makeSignupBody('dot', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    tenantIds.push(tenantId);

    // Seed a driver directly (admin bypasses RLS) with a medical card
    // expiring inside the 60-day horizon so the DQ + cron paths have data.
    const c = await ctx.admin.connect();
    try {
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class,
            license_number, license_expires_at, medical_card_expires_at,
            drug_test_last_at, road_test_completed_at)
         VALUES ($1,$2,'Dana','Driver','a',$3,$4,$5,$6,$7)`,
        [driverId, tenantId, 'DL-9001', isoDate(400), isoDate(30), isoDate(-30), isoDate(-100)],
      );
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const t of [
          'dot_incident_reports',
          'dot_drug_alcohol_tests',
          'dot_hos_logs',
          'dot_driver_qualifications',
          'dot_carrier_profile',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('DELETE FROM drivers WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('upserts the carrier profile (one per tenant)', async () => {
    const res = await inject('PUT', '/dot/carrier-profile', {
      legalName: 'Dana Towing LLC',
      usdotNumber: '7654321',
      carrierType: 'authorized_for_hire',
      operatingClassification: ['authorized_for_hire'],
      safetyRating: 'satisfactory',
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { usdotNumber: string; legalName: string };
    expect(body.usdotNumber).toBe('7654321');

    // Upsert again → still one row, updated.
    const res2 = await inject('PUT', '/dot/carrier-profile', { legalName: 'Dana Towing Inc' });
    expect(res2.statusCode).toBe(200);
    const get = await inject('GET', '/dot/carrier-profile');
    expect((get.json() as { legalName: string }).legalName).toBe('Dana Towing Inc');
  });

  it('records an HOS day that breaches the 11-hour limit and flags it in the week + packet', async () => {
    const day = '2026-05-10';
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 4, 10, h, m, 0)).toISOString();
    // 7h drive, 30-min break, 5h drive = 12h driving in one period.
    const entries = [
      { status: 'driving', startAt: at(10), endAt: at(17) },
      { status: 'off_duty', startAt: at(17), endAt: at(17, 30) },
      { status: 'driving', startAt: at(17, 30), endAt: at(22, 30) },
    ];
    for (const e of entries) {
      const r = await inject('POST', '/dot/hos', { driverId, logDate: day, ...e });
      expect(r.statusCode, r.body).toBe(201);
    }

    const week = await inject('GET', `/dot/hos/${driverId}/week?from=2026-05-10&to=2026-05-10`);
    expect(week.statusCode, week.body).toBe(200);
    const w = week.json() as { violations: { rule: string }[]; totalDrivingMinutes: number };
    expect(w.totalDrivingMinutes).toBe(720);
    expect(w.violations.some((v) => v.rule === 'driving_limit_11h')).toBe(true);

    const packet = await inject('GET', '/dot/audit-packet?from=2026-05-01&to=2026-05-31');
    expect(packet.statusCode, packet.body).toBe(200);
    expect(packet.headers['content-type']).toContain('application/pdf');
    expect(packet.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('records a drug test and a DOT-recordable incident', async () => {
    const drug = await inject('POST', '/dot/drug-tests', {
      driverId,
      testType: 'random',
      collectedAt: new Date('2026-05-12T12:00:00.000Z').toISOString(),
      result: 'negative',
      lab: 'LabCorp',
    });
    expect(drug.statusCode, drug.body).toBe(201);

    const incident = await inject('POST', '/dot/incidents', {
      occurredAt: new Date('2026-05-12T15:00:00.000Z').toISOString(),
      driverId,
      severity: 'injury',
      injuries: 1,
      towedAway: true,
      locationText: 'I-35',
    });
    expect(incident.statusCode, incident.body).toBe(201);
    // injury + tow ⇒ derived DOT-recordable.
    expect((incident.json() as { dotReportable: boolean }).dotReportable).toBe(true);

    const list = await inject('GET', '/dot/incidents');
    expect((list.json() as unknown[]).length).toBe(1);
  });

  it('records a DQ event and surfaces the driver in the DQ dashboard', async () => {
    const rec = await inject('POST', '/dot/drivers/dq', {
      driverId,
      employmentAppSignedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      mvrPulledAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      mvrExpiresAt: new Date('2027-01-01T00:00:00.000Z').toISOString(),
    });
    expect(rec.statusCode, rec.body).toBe(201);

    const dash = await inject('GET', '/dot/drivers/dq');
    expect(dash.statusCode).toBe(200);
    const rows = dash.json() as {
      driverId: string;
      expiring: { item: string }[];
    }[];
    const me = rows.find((r) => r.driverId === driverId);
    expect(me).toBeDefined();
    // Medical card expires in 30 days → should be flagged expiring.
    expect(me?.expiring.some((e) => e.item === 'medical_certificate')).toBe(true);
  });

  it('runs the expiry cron and raises an alert for the expiring medical card', async () => {
    const cron = ctx.app.get(DotExpiryCron);
    const result = await cron.tick(new Date());
    expect(result.driversScanned).toBeGreaterThanOrEqual(1);
    expect(result.alertsRaised).toBeGreaterThanOrEqual(1);
    expect(result.byItem.medical_certificate ?? 0).toBeGreaterThanOrEqual(1);
  });
});
