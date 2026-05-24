/**
 * Integration tests for the Repossession Workflow (Session 49) — drives the
 * real HTTP surface against the docker stack (Postgres + Redis). Covers the
 * full lifecycle: lienholder create → case intake → field attempt → recovery
 * (with the redemption window) → condition photos → personal property +
 * release → invoice preview → close, plus the duplicate-case-number guard,
 * the REPO_MODULE_ENABLED gate, and the audit trail.
 *
 * DB-gated via skipIfNoDb. Cleans up its own repo rows in afterAll BEFORE
 * tearDown() — the shared helper does not know about the repo tables and
 * tenant_id ON DELETE RESTRICT would otherwise block the tenant delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describeIfDb('integration — repo workflow', () => {
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
    // The module ships dark; enable it for this worker before the app boots.
    process.env.REPO_MODULE_ENABLED = 'true';
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('repo', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    tenantIds.push(tenantId);
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const t of [
          'repo_condition_photos',
          'repo_personal_property',
          'repo_recovery_events',
          'repo_location_attempts',
          'repo_cases',
          'lienholders',
        ]) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    if (ctx) await tearDown(ctx);
  });

  it('walks the full lifecycle: lienholder → case → attempt → recovery → photos → property → preview → close', async () => {
    // 1. lienholder
    const lhRes = await inject('POST', '/lienholders', {
      name: 'First National Bank',
      contactName: 'Dana Loan',
      phone: '555-0100',
      invoiceFormat: 'basic',
    });
    expect(lhRes.statusCode).toBe(201);
    const lienholder = lhRes.json() as { id: string };

    // 2. case intake (30-day redemption window)
    const caseRes = await inject('POST', '/repo-cases', {
      lienholderId: lienholder.id,
      caseNumber: 'RC-1001',
      vin: '1HGCM82633A004352',
      vehicleYear: 2019,
      vehicleMake: 'Honda',
      vehicleModel: 'Accord',
      debtorName: 'Sam Debtor',
      debtorAddress: '12 Main St',
      redemptionWindowDays: 30,
    });
    expect(caseRes.statusCode).toBe(201);
    const repoCase = caseRes.json() as { id: string; status: string };
    expect(repoCase.status).toBe('open');
    const caseId = repoCase.id;

    // 3. field attempt
    const attemptRes = await inject('POST', `/repo-cases/${caseId}/attempts`, {
      outcome: 'not_home',
      address: '12 Main St',
      notes: 'Vehicle not in driveway',
    });
    expect(attemptRes.statusCode).toBe(201);

    // 4. recovery (peaceful) — sets recovered + redemption window end
    const recRes = await inject('POST', `/repo-cases/${caseId}/recovery`, {
      recoveryType: 'peaceful',
      recoveredAt: '2026-05-01T12:00:00.000Z',
      odometer: 84210,
      conditionNotes: 'Minor scuff rear bumper',
    });
    expect(recRes.statusCode).toBe(201);
    const recBody = recRes.json() as { case: { status: string; redemptionEndsAt: string | null } };
    expect(recBody.case.status).toBe('recovered');
    // 2026-05-01 + 30 calendar days = 2026-05-31.
    expect(recBody.case.redemptionEndsAt).toBe('2026-05-31T12:00:00.000Z');

    // 5. condition photos (batch of the 8-slot checklist subset)
    const photoRes = await inject('POST', `/repo-cases/${caseId}/condition-photos`, {
      photos: [
        { photoUrl: 's3://k/front.jpg', photoType: 'exterior_front' },
        { photoUrl: 's3://k/odo.jpg', photoType: 'odometer' },
      ],
    });
    expect(photoRes.statusCode).toBe(201);
    expect((photoRes.json() as unknown[]).length).toBe(2);

    // 6. personal property + release
    const propRes = await inject('POST', `/repo-cases/${caseId}/personal-property`, {
      itemDescription: 'Child car seat',
    });
    expect(propRes.statusCode).toBe(201);
    const prop = propRes.json() as { id: string; releasedAt: string | null };
    expect(prop.releasedAt).toBeNull();
    const relRes = await inject(
      'POST',
      `/repo-cases/${caseId}/personal-property/${prop.id}/release`,
      { releasedTo: 'Sam Debtor' },
    );
    expect(relRes.statusCode).toBe(201);
    expect((relRes.json() as { releasedAt: string | null }).releasedAt).not.toBeNull();

    // 7. detail aggregate reflects every child
    const detailRes = await inject('GET', `/repo-cases/${caseId}`);
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json() as {
      attempts: unknown[];
      recoveryEvents: unknown[];
      personalProperty: unknown[];
      conditionPhotos: unknown[];
      lienholder: { name: string };
    };
    expect(detail.attempts.length).toBe(1);
    expect(detail.recoveryEvents.length).toBe(1);
    expect(detail.personalProperty.length).toBe(1);
    expect(detail.conditionPhotos.length).toBe(2);
    expect(detail.lienholder.name).toBe('First National Bank');

    // 8. invoice preview (recovery + skip-trace + storage + attempts)
    const previewRes = await inject('POST', `/repo-cases/${caseId}/invoice-preview`, {
      recoveryFeeCents: 35000,
      skipTraceFeeCents: 5000,
      storageDays: 3,
      storageDailyRateCents: 2500,
      attemptFeeCents: 1000,
      attemptCount: 1,
    });
    expect(previewRes.statusCode).toBe(201);
    const preview = previewRes.json() as { subtotalCents: number; lines: unknown[] };
    expect(preview.subtotalCents).toBe(35000 + 5000 + 7500 + 1000);
    expect(preview.lines.length).toBe(4);

    // 9. close (released to lienholder)
    const closeRes = await inject('POST', `/repo-cases/${caseId}/close`, { disposition: 'closed' });
    expect(closeRes.statusCode).toBe(201);
    expect((closeRes.json() as { status: string }).status).toBe('closed');

    // audit trail captured the writes
    const audits = await getAuditLogCount(ctx, tenantId, 'repo_cases');
    expect(audits).toBeGreaterThan(0);
  });

  it('rejects a duplicate active case number for the same lienholder (409)', async () => {
    const lh = (await inject('POST', '/lienholders', { name: 'Second Bank' })).json() as {
      id: string;
    };
    const first = await inject('POST', '/repo-cases', {
      lienholderId: lh.id,
      caseNumber: 'DUP-1',
    });
    expect(first.statusCode).toBe(201);
    const dup = await inject('POST', '/repo-cases', {
      lienholderId: lh.id,
      caseNumber: 'DUP-1',
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { code: string }).code).toBe('repo_case_duplicate_number');
  });

  it('blocks recording a recovery on an already-closed case (409 invalid state)', async () => {
    const lh = (await inject('POST', '/lienholders', { name: 'Third Bank' })).json() as {
      id: string;
    };
    const c = (
      await inject('POST', '/repo-cases', { lienholderId: lh.id, caseNumber: 'ST-1' })
    ).json() as { id: string };
    await inject('POST', `/repo-cases/${c.id}/close`, { disposition: 'cancelled' });
    const rec = await inject('POST', `/repo-cases/${c.id}/recovery`, { recoveryType: 'peaceful' });
    expect(rec.statusCode).toBe(409);
    expect((rec.json() as { code: string }).code).toBe('repo_case_invalid_state');
  });
});
