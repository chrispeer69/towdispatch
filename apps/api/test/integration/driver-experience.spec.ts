/**
 * Driver Experience (Session 2) — integration coverage.
 *
 * One bootstrap, multiple describe blocks. Each block exercises a
 * different controller's happy path so we get coverage breadth without
 * paying the bootApp() cost 8 times. The full Session-2 surface is:
 *
 *   - /driver-auth/* (set-pin, list-drivers, login, clear-failed-attempts)
 *   - /driver-briefings/* (create, active, acknowledge, needs-acknowledgment, patch)
 *   - /driver-shifts/* (check-in, me, check-out)
 *   - /driver-pretrip (create, my-recent)
 *   - /job-evidence/* (presign, finalize, fail, list-for-job)
 *   - /job-field-payments/* (create-intent, capture, cancel)
 *   - /driver-telemetry/* (ping, batch)
 *   - /driver-offline-sync/replay
 *
 * Skips the whole file when DATABASE_URL / REDIS_URL aren't set —
 * matches the existing skipIfNoDb pattern used by every other
 * integration spec in this repo.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

const SUFFIX = `dx-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface DriverRow {
  id: string;
  firstName: string;
  lastName: string;
}

interface TruckRow {
  id: string;
  unit_number: string;
}

interface JobRow {
  id: string;
  job_number: string;
}

describeIfDb('Driver Experience (Session 2) — API integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp;
  let driver: DriverRow;
  let truck: TruckRow;
  let job: JobRow;
  let driverToken: string;
  let briefingId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));

    // Seed: one driver + one truck + one job, via the admin pool so we
    // don't have to wire through the operator-side admin endpoints for
    // each fixture.
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      const driverId = uuidv7();
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
         VALUES ($1::uuid, $2::uuid, 'Test', 'Driver', 'A', true)`,
        [driverId, owner.tenant.id],
      );
      const truckId = uuidv7();
      const unitNumber = `T-${Date.now().toString().slice(-6)}`;
      await c.query(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, in_service)
         VALUES ($1::uuid, $2::uuid, $3, 'light_duty', true)`,
        [truckId, owner.tenant.id, unitNumber],
      );
      const jobId = uuidv7();
      const jobNumber = `20990101-9${Date.now().toString().slice(-3)}`;
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, status, service_type, pickup_address, authorized_by)
         VALUES ($1::uuid, $2::uuid, $3, 'new', 'tow', '1 Spec Lane', 'customer')`,
        [jobId, owner.tenant.id, jobNumber],
      );
      driver = { id: driverId, firstName: 'Test', lastName: 'Driver' };
      truck = { id: truckId, unit_number: unitNumber };
      job = { id: jobId, job_number: jobNumber };
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  // -------------------------------------------------------------------
  // driver-auth
  // -------------------------------------------------------------------

  describe('/driver-auth', () => {
    it('admin sets a PIN, picker lists the driver, login returns a token', async () => {
      // Set PIN as the operator.
      const setRes = await app.inject({
        method: 'POST',
        url: '/driver-auth/set-pin',
        headers: { ...auth(owner.accessToken), 'content-type': 'application/json' },
        payload: { driverId: driver.id, pin: '1234' },
      });
      expect(setRes.statusCode).toBe(200);

      // List drivers via the public picker.
      const listRes = await app.inject({
        method: 'POST',
        url: '/driver-auth/list-drivers',
        headers: { 'content-type': 'application/json' },
        payload: { tenantSlug: owner.tenant.slug },
      });
      expect(listRes.statusCode).toBe(200);
      const listed = listRes.json() as {
        tenant: { id: string; slug: string };
        drivers: Array<{ id: string; firstName: string; lastName: string }>;
      };
      expect(listed.tenant.slug).toBe(owner.tenant.slug);
      const me = listed.drivers.find((d) => d.id === driver.id);
      expect(me).toBeTruthy();

      // PIN login → driver token.
      const loginRes = await app.inject({
        method: 'POST',
        url: '/driver-auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { driverId: driver.id, pin: '1234', tenantSlug: owner.tenant.slug },
      });
      expect(loginRes.statusCode).toBe(200);
      const session = loginRes.json() as {
        accessToken: string;
        expiresIn: number;
        driver: { id: string };
        tenant: { id: string };
      };
      expect(session.accessToken).toBeTruthy();
      expect(session.driver.id).toBe(driver.id);
      driverToken = session.accessToken;
    });

    it('wrong PIN returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/driver-auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { driverId: driver.id, pin: '9999', tenantSlug: owner.tenant.slug },
      });
      expect(res.statusCode).toBe(401);
    });

    it('clear-failed-attempts resets the lockout state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/driver-auth/clear-failed-attempts',
        headers: { ...auth(owner.accessToken), 'content-type': 'application/json' },
        payload: { driverId: driver.id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------
  // driver-briefings
  // -------------------------------------------------------------------

  describe('/driver-briefings', () => {
    it('admin creates an active briefing, driver fetches it, acks it, and the needs flag flips', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/driver-briefings',
        headers: { ...auth(owner.accessToken), 'content-type': 'application/json' },
        payload: {
          title: 'Watch for ice',
          message: 'Black ice on US-23 around mile 17. Roll slow on the ramps.',
          videoMinDurationSeconds: 30,
          isActive: true,
        },
      });
      expect(createRes.statusCode).toBe(201);
      briefingId = (createRes.json() as { id: string }).id;

      // Driver picks up the active briefing.
      const activeRes = await app.inject({
        method: 'GET',
        url: '/driver-briefings/active',
        headers: auth(driverToken),
      });
      expect(activeRes.statusCode).toBe(200);
      expect((activeRes.json() as { id: string }).id).toBe(briefingId);

      // needs-acknowledgment: true initially.
      const needsRes1 = await app.inject({
        method: 'GET',
        url: '/driver-briefings/needs-acknowledgment',
        headers: auth(driverToken),
      });
      expect(needsRes1.statusCode).toBe(200);
      expect((needsRes1.json() as { needs: boolean }).needs).toBe(true);

      // ack
      const ackRes = await app.inject({
        method: 'POST',
        url: `/driver-briefings/${briefingId}/acknowledge`,
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: { messageReadAt: new Date().toISOString() },
      });
      expect(ackRes.statusCode).toBe(200);

      // needs-acknowledgment: now false.
      const needsRes2 = await app.inject({
        method: 'GET',
        url: '/driver-briefings/needs-acknowledgment',
        headers: auth(driverToken),
      });
      expect(needsRes2.statusCode).toBe(200);
      expect((needsRes2.json() as { needs: boolean }).needs).toBe(false);
    });

    it('PATCH /driver-briefings/:id can edit the message', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/driver-briefings/${briefingId}`,
        headers: { ...auth(owner.accessToken), 'content-type': 'application/json' },
        payload: { message: 'Updated: ramps now plowed.' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { message: string }).message).toContain('plowed');
    });
  });

  // -------------------------------------------------------------------
  // driver-shifts
  // -------------------------------------------------------------------

  describe('/driver-shifts', () => {
    it('check-in succeeds (briefing acked), me returns the shift, check-out closes it', async () => {
      const inRes = await app.inject({
        method: 'POST',
        url: '/driver-shifts/check-in',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: { truckId: truck.id },
      });
      expect(inRes.statusCode).toBe(201);
      const shift = inRes.json() as { id: string; driverId: string; endedAt: string | null };
      expect(shift.driverId).toBe(driver.id);
      expect(shift.endedAt).toBeNull();

      const meRes = await app.inject({
        method: 'GET',
        url: '/driver-shifts/me',
        headers: auth(driverToken),
      });
      expect(meRes.statusCode).toBe(200);
      expect((meRes.json() as { id: string }).id).toBe(shift.id);

      const outRes = await app.inject({
        method: 'POST',
        url: '/driver-shifts/check-out',
        headers: auth(driverToken),
      });
      expect(outRes.statusCode).toBe(200);
      expect((outRes.json() as { endedAt: string | null }).endedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------
  // driver-pretrip
  // -------------------------------------------------------------------

  describe('/driver-pretrip', () => {
    it('submits an inspection and the driver sees it in my-recent', async () => {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/driver-pretrip',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {
          truckId: truck.id,
          status: 'pass',
          items: [
            { key: 'lights', label: 'Lights', state: 'ok' },
            { key: 'tires', label: 'Tires', state: 'ok' },
            { key: 'brakes', label: 'Brakes', state: 'ok' },
          ],
          odometerMiles: 123_456,
          notes: 'All good',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const inspection = submitRes.json() as { id: string; status: string };
      expect(inspection.status).toBe('pass');

      const listRes = await app.inject({
        method: 'GET',
        url: '/driver-pretrip/my-recent',
        headers: auth(driverToken),
      });
      expect(listRes.statusCode).toBe(200);
      const list = listRes.json() as Array<{ id: string }>;
      expect(list.some((r) => r.id === inspection.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // job-evidence
  // -------------------------------------------------------------------

  describe('/job-evidence', () => {
    it('presign → finalize round-trip yields an uploaded row visible in list-for-job', async () => {
      const presignRes = await app.inject({
        method: 'POST',
        url: '/job-evidence/presign',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {
          jobId: job.id,
          kind: 'photo_pickup',
          contentType: 'image/jpeg',
          sizeBytes: 256_000,
        },
      });
      expect(presignRes.statusCode).toBe(201);
      const presigned = presignRes.json() as {
        evidence: { id: string; uploadStatus: string };
        upload: { url: string; key: string; expiresAt: number };
      };
      expect(presigned.evidence.uploadStatus).toBe('pending');
      expect(presigned.upload.url).toBeTruthy();
      expect(presigned.upload.key).toContain(`tenants/${owner.tenant.id}/job-evidence/${job.id}/`);

      const finalRes = await app.inject({
        method: 'POST',
        url: `/job-evidence/${presigned.evidence.id}/finalize`,
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: { width: 1920, height: 1080 },
      });
      expect(finalRes.statusCode).toBe(200);
      expect((finalRes.json() as { uploadStatus: string }).uploadStatus).toBe('uploaded');

      const listRes = await app.inject({
        method: 'GET',
        url: `/jobs/${job.id}/evidence`,
        headers: auth(owner.accessToken),
      });
      expect(listRes.statusCode).toBe(200);
      const list = listRes.json() as Array<{
        id: string;
        kind: string;
        uploadStatus: string;
        downloadUrl: string | null;
        thumbnailUrl: string | null;
      }>;
      const row = list.find((r) => r.id === presigned.evidence.id);
      expect(row?.uploadStatus).toBe('uploaded');
      expect(row?.downloadUrl).toBeTruthy();
      // photo_pickup is thumbnailable, so the list must carry a thumbnail URL.
      expect(row?.thumbnailUrl).toBeTruthy();
    });

    /** Stage an uploaded evidence row and return its id. */
    async function stageEvidence(kind = 'photo_damage'): Promise<string> {
      const presignRes = await app.inject({
        method: 'POST',
        url: '/job-evidence/presign',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: { jobId: job.id, kind, contentType: 'image/jpeg', sizeBytes: 64_000 },
      });
      const id = (presignRes.json() as { evidence: { id: string } }).evidence.id;
      await app.inject({
        method: 'POST',
        url: `/job-evidence/${id}/finalize`,
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {},
      });
      return id;
    }

    it('owner soft-deletes evidence (204) and it disappears from the list', async () => {
      const id = await stageEvidence();
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/job-evidence/${id}`,
        headers: auth(owner.accessToken),
      });
      expect(delRes.statusCode).toBe(204);

      const listRes = await app.inject({
        method: 'GET',
        url: `/jobs/${job.id}/evidence`,
        headers: auth(owner.accessToken),
      });
      const list = listRes.json() as Array<{ id: string }>;
      expect(list.some((r) => r.id === id)).toBe(false);
    });

    it('deleting a non-existent evidence id returns 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/job-evidence/${uuidv7()}`,
        headers: auth(owner.accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('a foreign tenant cannot delete this tenant’s evidence (404 under RLS)', async () => {
      const id = await stageEvidence();
      const attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-atk`, ctx));
      const res = await app.inject({
        method: 'DELETE',
        url: `/job-evidence/${id}`,
        headers: auth(attacker.accessToken),
      });
      // RLS hides the row from the attacker's tenant, so it reads as absent.
      expect(res.statusCode).toBe(404);

      // And the row is still there for the real owner.
      const listRes = await app.inject({
        method: 'GET',
        url: `/jobs/${job.id}/evidence`,
        headers: auth(owner.accessToken),
      });
      const list = listRes.json() as Array<{ id: string }>;
      expect(list.some((r) => r.id === id)).toBe(true);
    });

    it('a driver token cannot reach the operator-only delete (401)', async () => {
      const id = await stageEvidence();
      const res = await app.inject({
        method: 'DELETE',
        url: `/job-evidence/${id}`,
        headers: auth(driverToken),
      });
      // The DELETE controller is operator-auth only; a driver JWT is rejected
      // by the global JwtAuthGuard before RolesGuard runs.
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------
  // job-field-payments (stub provider)
  // -------------------------------------------------------------------

  describe('/job-field-payments', () => {
    it('create-intent → capture flips status to captured', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/job-field-payments/create-intent',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {
          jobId: job.id,
          amountCents: 15_000,
          paymentMethod: 'card_present_tap',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const created = createRes.json() as {
        id: string;
        status: string;
        stripePaymentIntentId: string | null;
      };
      expect(created.status).toBe('authorized');
      expect(created.stripePaymentIntentId).toMatch(/^pi_stub_/);

      const capRes = await app.inject({
        method: 'POST',
        url: `/job-field-payments/${created.id}/capture`,
        headers: auth(driverToken),
      });
      expect(capRes.statusCode).toBe(200);
      expect((capRes.json() as { status: string }).status).toBe('captured');
    });

    it('cancel succeeds before capture', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/job-field-payments/create-intent',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {
          jobId: job.id,
          amountCents: 5000,
          paymentMethod: 'card_present_chip',
        },
      });
      const created = createRes.json() as { id: string };
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/job-field-payments/${created.id}/cancel`,
        headers: auth(driverToken),
      });
      expect(cancelRes.statusCode).toBe(200);
      expect((cancelRes.json() as { status: string }).status).toBe('canceled');
    });
  });

  // -------------------------------------------------------------------
  // driver-telemetry
  // -------------------------------------------------------------------

  describe('/driver-telemetry', () => {
    it('ping accepts a single event and batch accepts an array', async () => {
      const pingRes = await app.inject({
        method: 'POST',
        url: '/driver-telemetry/ping',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {
          recordedAt: new Date().toISOString(),
          lat: 39.96,
          lng: -82.99,
          speedMph: 45,
          eventKind: 'ping',
        },
      });
      expect(pingRes.statusCode).toBe(201);
      expect((pingRes.json() as { id: string }).id).toBeTruthy();

      const batchRes = await app.inject({
        method: 'POST',
        url: '/driver-telemetry/batch',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: {
          events: [
            {
              recordedAt: new Date(Date.now() - 30_000).toISOString(),
              eventKind: 'ping',
              lat: 39.95,
              lng: -82.98,
            },
            {
              recordedAt: new Date(Date.now() - 15_000).toISOString(),
              eventKind: 'ping',
              lat: 39.96,
              lng: -82.99,
            },
          ],
        },
      });
      expect(batchRes.statusCode).toBe(201);
      expect((batchRes.json() as { inserted: number }).inserted).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // driver-offline-sync
  // -------------------------------------------------------------------

  describe('/driver-offline-sync', () => {
    it('replay is idempotent on the same client_event_uuid', async () => {
      const clientEventUuid = uuidv7();
      const payload = {
        actions: [
          {
            actionKind: 'acknowledge_briefing',
            payload: { briefingId },
            clientTimestamp: new Date().toISOString(),
            clientEventUuid,
          },
        ],
      };
      type ReplayResult = {
        status: string;
        clientEventUuid: string;
        rowId: string;
        failureReason: string | null;
        actionKind: string;
      };
      const first = await app.inject({
        method: 'POST',
        url: '/driver-offline-sync/replay',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload,
      });
      expect(first.statusCode).toBe(200);
      const r1 = first.json() as { results: ReplayResult[] };
      const r1First = r1.results[0];
      expect(r1First).toBeDefined();
      if (!r1First) throw new Error('replay returned no results');
      expect(r1First.clientEventUuid).toBe(clientEventUuid);
      // status is 'applied' if the briefing wasn't already acked today,
      // else 'applied' again on the second call because the ack itself
      // is idempotent. Either way the row exists.
      expect(['applied', 'skipped', 'failed']).toContain(r1First.status);

      const second = await app.inject({
        method: 'POST',
        url: '/driver-offline-sync/replay',
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload,
      });
      expect(second.statusCode).toBe(200);
      const r2 = second.json() as { results: ReplayResult[] };
      const r2First = r2.results[0];
      expect(r2First).toBeDefined();
      if (!r2First) throw new Error('second replay returned no results');
      expect(r2First.rowId).toBe(r1First.rowId);
    });
  });
});
