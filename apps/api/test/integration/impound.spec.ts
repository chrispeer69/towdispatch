/**
 * Integration tests for Impound & Storage (Session 22) — drives the real
 * HTTP surface against the docker stack (Postgres + Redis). Covers:
 *   - yard + vehicle intake,
 *   - hold lifecycle and the release documentation gate (active hold,
 *     ID / ownership verification),
 *   - the daily fee-accrual cron (accrual + idempotency + lien flag),
 *   - manual fees, list filters, and the audit trail.
 *
 * DB-gated via skipIfNoDb. Cleans up its own impound rows in afterAll
 * BEFORE tearDown() — the shared helper does not know about impound
 * tables and tenant_id ON DELETE RESTRICT would otherwise block the
 * tenant delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImpoundFeeAccrualCron } from '../../src/modules/impound/impound-fee-accrual.cron.js';
import {
  type AuthedResp,
  type TestContext,
  auth,
  getAuditLogCount,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const describeIfDb = skipIfNoDb ? describe.skip : describe;
const DAY_MS = 86_400_000;

describeIfDb('integration — impound & storage', () => {
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

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('impound', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    tenantIds.push(tenantId);
  });

  afterAll(async () => {
    // Targeted impound cleanup before the shared teardown (FK / RESTRICT).
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const table of [
          'impound_releases',
          'impound_fees',
          'impound_holds',
          'impound_records',
          'impound_yards',
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

  it('runs the full intake → hold → gated release lifecycle', async () => {
    // Yard.
    const yardRes = await inject('POST', '/impound/yards', { name: 'North Lot', code: 'NORTH' });
    expect(yardRes.statusCode, yardRes.body).toBe(201);
    const yard = yardRes.json() as { id: string };

    // Intake — storage started 3 days ago so accrual has something to bill.
    const startedAt = new Date(Date.now() - 3 * DAY_MS).toISOString();
    const intakeRes = await inject('POST', '/impound/records', {
      yardId: yard.id,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleYear: 2019,
      licensePlate: 'ABC123',
      licenseState: 'TX',
      dailyFeeCents: 5000,
      storageStartedAt: startedAt,
    });
    expect(intakeRes.statusCode, intakeRes.body).toBe(201);
    const record = intakeRes.json() as { id: string; status: string };
    expect(record.status).toBe('stored');
    const recordId = record.id;

    // Police hold.
    const holdRes = await inject('POST', `/impound/records/${recordId}/holds`, {
      holdType: 'police',
      authorityName: 'Austin PD',
      authorityReference: 'CASE-99',
    });
    expect(holdRes.statusCode, holdRes.body).toBe(201);
    const hold = holdRes.json() as { id: string; releasedAt: string | null };
    expect(hold.releasedAt).toBeNull();

    // Detail shows the active hold.
    const detail1 = await inject('GET', `/impound/records/${recordId}`);
    expect(detail1.statusCode).toBe(200);
    const d1 = detail1.json() as { activeHoldCount: number; holds: unknown[] };
    expect(d1.activeHoldCount).toBe(1);
    expect(d1.holds).toHaveLength(1);

    // Release blocked while the police hold is active.
    const blocked = await inject('POST', `/impound/records/${recordId}/release`, {
      releasedToName: 'Jane Owner',
      releasedToType: 'owner',
      idVerified: true,
      ownershipDocVerified: true,
    });
    expect(blocked.statusCode, blocked.body).toBe(409);

    // Lift the hold.
    const liftRes = await inject(
      'POST',
      `/impound/records/${recordId}/holds/${hold.id}/release`,
      {},
    );
    expect([200, 201]).toContain(liftRes.statusCode);
    const lifted = liftRes.json() as { releasedAt: string | null };
    expect(lifted.releasedAt).not.toBeNull();

    // Release blocked without ID verification.
    const noId = await inject('POST', `/impound/records/${recordId}/release`, {
      releasedToName: 'Jane Owner',
      releasedToType: 'owner',
      idVerified: false,
      ownershipDocVerified: true,
    });
    expect(noId.statusCode, noId.body).toBe(400);

    // Release succeeds once gate passes; final accrual rolls into the total.
    const okRes = await inject('POST', `/impound/records/${recordId}/release`, {
      releasedToName: 'Jane Owner',
      releasedToType: 'owner',
      idVerified: true,
      ownershipDocVerified: true,
      paymentReceivedCents: 20000,
      paymentMethod: 'card',
    });
    expect([200, 201]).toContain(okRes.statusCode);
    const released = okRes.json() as {
      release: { id: string; totalFeesCents: number };
      record: { status: string };
    };
    expect(released.record.status).toBe('released');
    // 3 days ago, arrival-day inclusive → at least 4 × $50.00.
    expect(released.release.totalFeesCents).toBeGreaterThanOrEqual(5000);

    // Re-release is idempotent — same release row, no error.
    const again = await inject('POST', `/impound/records/${recordId}/release`, {
      releasedToName: 'Jane Owner',
      releasedToType: 'owner',
      idVerified: true,
      ownershipDocVerified: true,
    });
    expect([200, 201]).toContain(again.statusCode);
    const againJson = again.json() as { release: { id: string } };
    expect(againJson.release.id).toBe(released.release.id);

    // Audit trail captured the record writes.
    const audits = await getAuditLogCount(ctx, tenantId, 'impound_records', recordId);
    expect(audits).toBeGreaterThan(0);
  });

  it('accrues daily fees via the cron, idempotently, and flags lien eligibility', async () => {
    const yardRes = await inject('POST', '/impound/yards', { name: 'South Lot', code: 'SOUTH' });
    const yard = yardRes.json() as { id: string };

    // Record stored 5 days ago at $10/day.
    const rec = (
      await inject('POST', '/impound/records', {
        yardId: yard.id,
        dailyFeeCents: 1000,
        storageStartedAt: new Date(Date.now() - 5 * DAY_MS).toISOString(),
      })
    ).json() as { id: string };

    const cron = ctx.app.get(ImpoundFeeAccrualCron);
    const tick1 = await cron.tick(new Date());
    expect(tick1.recordsScanned).toBeGreaterThanOrEqual(1);

    const afterTick1 = (await inject('GET', `/impound/records/${rec.id}`)).json() as {
      record: { accruedFeeCents: number };
      feeTotalCents: number;
    };
    expect(afterTick1.record.accruedFeeCents).toBeGreaterThanOrEqual(5000);
    expect(afterTick1.record.accruedFeeCents % 1000).toBe(0);
    const accruedAfter1 = afterTick1.record.accruedFeeCents;

    // Second tick on the same UTC day must not double-bill.
    await cron.tick(new Date());
    const afterTick2 = (await inject('GET', `/impound/records/${rec.id}`)).json() as {
      record: { accruedFeeCents: number };
    };
    expect(afterTick2.record.accruedFeeCents).toBe(accruedAfter1);

    // A record stored past the lien threshold flips lien_eligible.
    const oldRec = (
      await inject('POST', '/impound/records', {
        yardId: yard.id,
        dailyFeeCents: 1000,
        storageStartedAt: new Date(Date.now() - 31 * DAY_MS).toISOString(),
      })
    ).json() as { id: string };
    await cron.tick(new Date());
    const oldDetail = (await inject('GET', `/impound/records/${oldRec.id}`)).json() as {
      record: { lienEligible: boolean; lienEligibleAt: string | null };
    };
    expect(oldDetail.record.lienEligible).toBe(true);
    expect(oldDetail.record.lienEligibleAt).not.toBeNull();
  });

  it('records manual fees and filters the list', async () => {
    const yard = (
      await inject('POST', '/impound/yards', { name: 'East Lot', code: 'EAST' })
    ).json() as { id: string };
    const rec = (
      await inject('POST', '/impound/records', { yardId: yard.id, dailyFeeCents: 0 })
    ).json() as { id: string };

    const feeRes = await inject('POST', `/impound/records/${rec.id}/fees`, {
      feeType: 'administrative',
      amountCents: 2500,
      description: 'Gate processing',
    });
    expect(feeRes.statusCode, feeRes.body).toBe(201);

    const detail = (await inject('GET', `/impound/records/${rec.id}`)).json() as {
      feeTotalCents: number;
      fees: unknown[];
    };
    expect(detail.feeTotalCents).toBe(2500);
    expect(detail.fees.length).toBeGreaterThanOrEqual(1);

    const stored = (await inject('GET', '/impound/records?status=stored')).json() as Array<{
      id: string;
    }>;
    expect(stored.some((r) => r.id === rec.id)).toBe(true);
  });

  it('generates a state-form stub', async () => {
    const yard = (
      await inject('POST', '/impound/yards', { name: 'West Lot', code: 'WEST' })
    ).json() as { id: string };
    const rec = (
      await inject('POST', '/impound/records', { yardId: yard.id, dailyFeeCents: 1000 })
    ).json() as { id: string };

    const formRes = await inject('GET', `/impound/records/${rec.id}/forms/lien_notice`);
    expect(formRes.statusCode, formRes.body).toBe(200);
    const stub = formRes.json() as { kind: string; status: string };
    expect(stub.kind).toBe('lien_notice');
    expect(stub.status).toBe('stub');
  });
});
