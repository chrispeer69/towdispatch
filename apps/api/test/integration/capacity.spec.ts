/**
 * CADS integration coverage (gates 3 of the CADS build):
 *   - event-driven recompute fires on shift + job status changes
 *   - manual override precedence + clear
 *   - outbound webhook delivery is HMAC-signed and verifiable
 *   - retry ladder walks to dead_letter on a failing sink
 *   - pull API auth (valid / invalid / disabled) + class visibility +
 *     history + per-key rate limit
 *
 * Real Nest app against the docker Postgres + Redis; rows seeded via the
 * admin pool; domain events fired through DispatchEventsService exactly as
 * the services do.
 */
import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@ustowdispatch/db';
import { type CapacityStatusDto, DISPATCH_EVENTS } from '@ustowdispatch/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CapacityBroadcastWorker } from '../../src/modules/capacity/capacity-broadcast.worker.js';
import { DispatchEventsService } from '../../src/modules/dispatch/dispatch-events.service.js';
import { verifySignature } from '../../src/modules/public-api/crypto/webhook-signature.js';
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

const SUFFIX = `cads-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface CapturedRequest {
  headers: IncomingMessage['headers'];
  body: string;
}

/** Tiny local sink: /ok answers 200 and records; /fail answers 500. */
function startSink(): Promise<{ server: Server; port: number; captured: CapturedRequest[] }> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8');
    });
    req.on('end', () => {
      captured.push({ headers: req.headers, body });
      res.statusCode = req.url?.includes('fail') ? 500 : 200;
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, captured });
    });
  });
}

describeIfDb('CADS capacity integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp;
  let tenantId: string;
  let sink: { server: Server; port: number; captured: CapturedRequest[] };

  const jobIds: string[] = [];

  async function status(): Promise<CapacityStatusDto> {
    const res = await app.inject({
      method: 'GET',
      url: '/capacity/status',
      headers: auth(owner.accessToken),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as CapacityStatusDto;
  }

  /** Poll until the live status satisfies `pred` (event path is async). */
  async function waitForStatus(
    pred: (s: CapacityStatusDto) => boolean,
    label: string,
    timeoutMs = 5000,
  ): Promise<CapacityStatusDto> {
    const start = Date.now();
    let last: CapacityStatusDto | null = null;
    while (Date.now() - start < timeoutMs) {
      last = await status();
      if (pred(last)) return last;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`waitForStatus timeout: ${label} — last=${JSON.stringify(last)}`);
  }

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    tenantId = owner.tenant.id;
    sink = await startSink();
  });

  afterAll(async () => {
    sink?.server.close();
    await tearDown(ctx);
  });

  it('recompute fires on driver shift start (event-driven, no polling)', async () => {
    // Seed: one light-duty in-service truck + one driver on an open shift.
    const truckId = uuidv7();
    const driverId = uuidv7();
    const c = await ctx.admin.connect();
    try {
      await c.query(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, duty_class, status, in_service)
         VALUES ($1, $2, 'T-CADS-1', 'flatbed', 'light', 'active', true)`,
        [truckId, tenantId],
      );
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name)
         VALUES ($1, $2, 'Cads', 'Driver')`,
        [driverId, tenantId],
      );
      await c.query(
        `INSERT INTO driver_shifts (id, tenant_id, driver_id, truck_id, status)
         VALUES ($1, $2, $3, $4, 'available')`,
        [uuidv7(), tenantId, driverId, truckId],
      );
    } finally {
      c.release();
    }

    // Fire the same event DriversService emits on clock-on.
    const events = app.get(DispatchEventsService);
    events.emit(tenantId, DISPATCH_EVENTS.DRIVER_SHIFT_STARTED, {
      shiftId: uuidv7(),
      driverId,
      truckId,
      startedAt: new Date().toISOString(),
    });

    const s = await waitForStatus(
      (st) => st.classes.some((cl) => cl.dutyClass === 'light' && cl.eligibleDrivers === 1),
      'light class sees 1 eligible driver',
    );
    const light = s.classes.find((cl) => cl.dutyClass === 'light');
    expect(light?.band).toBe('available_now');
    expect(light?.ratio).toBe(0);
    // No drivers in medium/heavy => those classes are OFFLINE.
    expect(s.classes.find((cl) => cl.dutyClass === 'heavy')?.band).toBe('offline');
    expect(s.blended.eligibleDrivers).toBe(1);
  });

  it('recompute fires on job status transition and moves the band', async () => {
    // Two active light jobs against one driver → ratio 2.0 → constrained
    // (decisively past the boundaries, so hysteresis flips immediately).
    const c = await ctx.admin.connect();
    try {
      // job_number must satisfy the ^[0-9]{8}-[0-9]{4,}$ CHECK.
      for (let i = 0; i < 2; i += 1) {
        const id = uuidv7();
        jobIds.push(id);
        await c.query(
          `INSERT INTO jobs (id, tenant_id, job_number, service_type, status, duty_class, pickup_address, authorized_by)
           VALUES ($1, $2, $3, 'tow', 'dispatched', 'light', '123 Test St', 'customer')`,
          [id, tenantId, `20260714-99${String(i).padStart(2, '0')}`],
        );
      }
    } finally {
      c.release();
    }

    const events = app.get(DispatchEventsService);
    events.emit(tenantId, DISPATCH_EVENTS.JOB_STATUS_CHANGED, {
      jobId: jobIds[0] as string,
      jobNumber: '20260714-9900',
      fromStatus: 'new',
      toStatus: 'dispatched',
      actorUserId: owner.user.id,
    });

    const s = await waitForStatus(
      (st) => (st.classes.find((cl) => cl.dutyClass === 'light')?.weightedActiveJobs ?? 0) === 2,
      'light class counts 2.0 weighted jobs',
    );
    const light = s.classes.find((cl) => cl.dutyClass === 'light');
    expect(light?.ratio).toBe(2);
    expect(light?.band).toBe('constrained');
  });

  it('manual override wins over the computed band and clears cleanly', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/capacity/overrides',
      headers: auth(owner.accessToken),
      payload: { dutyClass: 'all', forcedBand: 'at_capacity', reason: 'storm mode test' },
    });
    expect(createRes.statusCode).toBe(201);
    const override = createRes.json() as { id: string };

    const forced = await waitForStatus(
      (st) => st.blended.overrideActive && st.blended.band === 'at_capacity',
      'override forces at_capacity',
    );
    // Computed band keeps calculating underneath.
    expect(forced.classes.find((cl) => cl.dutyClass === 'light')?.computedBand).toBe('constrained');
    expect(forced.activeOverrides).toHaveLength(1);

    const clearRes = await app.inject({
      method: 'DELETE',
      url: `/capacity/overrides/${override.id}`,
      headers: auth(owner.accessToken),
    });
    expect(clearRes.statusCode).toBe(204);
    await waitForStatus(
      (st) => !st.blended.overrideActive && st.activeOverrides.length === 0,
      'computed status resumes after clear',
    );
  });

  it('webhook broadcast is HMAC-signed and verifiable by the partner', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/capacity/partners',
      headers: auth(owner.accessToken),
      payload: {
        name: 'Echo Partner',
        networkCode: 'generic',
        deliveryMode: 'webhook',
        webhookUrl: `http://127.0.0.1:${sink.port}/ok`,
        classVisibility: ['light', 'medium', 'heavy'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const creds = createRes.json() as {
      partner: { id: string };
      webhookSecret: string | null;
      apiKey: string | null;
    };
    // Credentials are returned exactly once at creation.
    expect(creds.webhookSecret).toMatch(/^whsec_/);
    expect(creds.apiKey).toMatch(/^tc_(live|test)_/);

    const fireRes = await app.inject({
      method: 'POST',
      url: `/capacity/partners/${creds.partner.id}/test-fire`,
      headers: auth(owner.accessToken),
    });
    expect(fireRes.statusCode).toBe(200);
    const fire = fireRes.json() as { delivered: boolean; httpStatus: number | null };
    expect(fire.delivered).toBe(true);
    expect(fire.httpStatus).toBe(200);

    const hit = sink.captured.at(-1);
    expect(hit).toBeDefined();
    if (!hit) throw new Error('sink captured nothing');
    const sigHeader = hit.headers['x-towcommand-signature'] as string;
    expect(sigHeader).toBeTruthy();
    expect(hit.headers['x-towcommand-delivery-id']).toBeTruthy();
    // Partner-side verification: same helper the docs hand to partners.
    expect(verifySignature(creds.webhookSecret as string, hit.body, sigHeader)).toBe(true);
    // Tampered body must fail verification.
    expect(verifySignature(creds.webhookSecret as string, `${hit.body} `, sigHeader)).toBe(false);

    const payload = JSON.parse(hit.body) as Record<string, unknown>;
    expect(payload.schema_version).toBe('1.0');
    expect(payload.tenant_id).toBe(tenantId);
    expect(payload.guideline_minutes).toBe(60);
    expect(payload.blended).toBeDefined();
  });

  it('retry ladder walks a failing sink to dead_letter (max 5 attempts)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/capacity/partners',
      headers: auth(owner.accessToken),
      payload: {
        name: 'Failing Partner',
        networkCode: 'generic',
        deliveryMode: 'webhook',
        webhookUrl: `http://127.0.0.1:${sink.port}/fail`,
        classVisibility: ['light'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const partnerId = (createRes.json() as { partner: { id: string } }).partner.id;

    const broadcastId = uuidv7();
    const c = await ctx.admin.connect();
    try {
      await c.query(
        `INSERT INTO capacity_broadcasts (id, tenant_id, partner_id, payload, status, retry_count, next_retry_at)
         VALUES ($1, $2, $3, '{"schema_version":"1.0"}'::jsonb, 'pending', 0, now())`,
        [broadcastId, tenantId, partnerId],
      );
    } finally {
      c.release();
    }

    const worker = app.get(CapacityBroadcastWorker);
    let now = new Date();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const outcome = await worker.attempt(broadcastId, { now });
      expect(outcome.delivered).toBe(false);
      expect(outcome.httpStatus).toBe(500);
      const row = await ctx.admin.query<{
        status: string;
        retry_count: number;
        next_retry_at: Date | null;
      }>('SELECT status, retry_count, next_retry_at FROM capacity_broadcasts WHERE id = $1', [
        broadcastId,
      ]);
      const b = row.rows[0];
      expect(b?.retry_count).toBe(attempt);
      if (attempt < 5) {
        expect(b?.status).toBe('pending');
        expect(b?.next_retry_at).not.toBeNull();
        now = new Date((b?.next_retry_at as Date).getTime() + 1000);
      } else {
        expect(b?.status).toBe('dead_letter');
        expect(b?.next_retry_at).toBeNull();
      }
    }

    // The receipts log shows the dead-lettered delivery.
    const logRes = await app.inject({
      method: 'GET',
      url: `/capacity/broadcasts?partnerId=${partnerId}&status=dead_letter`,
      headers: auth(owner.accessToken),
    });
    expect(logRes.statusCode).toBe(200);
    const page = logRes.json() as { total: number; items: Array<{ lastError: string | null }> };
    expect(page.total).toBe(1);
    expect(page.items[0]?.lastError).toContain('HTTP 500');
  });

  it('pull API: auth, class visibility scoping, history, rate limit', async () => {
    // Light-only partner to prove visibility scoping.
    const createRes = await app.inject({
      method: 'POST',
      url: '/capacity/partners',
      headers: auth(owner.accessToken),
      payload: {
        name: 'Pull Partner',
        networkCode: 'aaa',
        deliveryMode: 'pull_only',
        classVisibility: ['light'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const creds = createRes.json() as { partner: { id: string }; apiKey: string | null };
    const key = creds.apiKey as string;

    // Invalid key → 401.
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/capacity',
      headers: { authorization: `Bearer ${key.slice(0, -4)}beef` },
    });
    expect(bad.statusCode).toBe(401);

    // Valid key → the live payload, scoped to light + blended.
    const ok = await app.inject({
      method: 'GET',
      url: '/v1/capacity',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(ok.statusCode).toBe(200);
    const payload = ok.json() as {
      schema_version: string;
      classes: Record<string, unknown>;
      blended: Record<string, unknown>;
      override_active: boolean;
    };
    expect(payload.schema_version).toBe('1.0');
    expect(Object.keys(payload.classes)).toEqual(['light']);
    expect(payload.blended).toBeDefined();

    // History: snapshots persisted by earlier recomputes, light+all only.
    const hist = await app.inject({
      method: 'GET',
      url: '/v1/capacity/history?hours=24&per_page=50',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(hist.statusCode).toBe(200);
    const history = hist.json() as { total: number; entries: Array<{ duty_class: string }> };
    expect(history.total).toBeGreaterThan(0);
    expect(new Set(history.entries.map((e) => e.duty_class))).toEqual(
      new Set(['light', 'all'].filter((s) => history.entries.some((e) => e.duty_class === s))),
    );
    for (const e of history.entries) {
      expect(['light', 'all']).toContain(e.duty_class);
    }

    // Disabled partner → 403.
    const disable = await app.inject({
      method: 'PATCH',
      url: `/capacity/partners/${creds.partner.id}`,
      headers: auth(owner.accessToken),
      payload: { enabled: false },
    });
    expect(disable.statusCode).toBe(200);
    const forbidden = await app.inject({
      method: 'GET',
      url: '/v1/capacity',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(forbidden.statusCode).toBe(403);
    await app.inject({
      method: 'PATCH',
      url: `/capacity/partners/${creds.partner.id}`,
      headers: auth(owner.accessToken),
      payload: { enabled: true },
    });

    // Rate limit: 60/min per key → request #61 inside the window is 429.
    let rateLimited = false;
    for (let i = 0; i < 61; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/capacity',
        headers: { authorization: `Bearer ${key}` },
      });
      if (res.statusCode === 429) {
        rateLimited = true;
        expect(res.headers['retry-after']).toBeTruthy();
        break;
      }
      expect(res.statusCode).toBe(200);
    }
    expect(rateLimited).toBe(true);
  });

  it('rotating the pull key invalidates the old key immediately', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/capacity/partners',
      headers: auth(owner.accessToken),
      payload: { name: 'Rotate Partner', deliveryMode: 'pull_only', classVisibility: ['light'] },
    });
    const creds = createRes.json() as { partner: { id: string }; apiKey: string | null };
    const oldKey = creds.apiKey as string;

    const rotateRes = await app.inject({
      method: 'POST',
      url: `/capacity/partners/${creds.partner.id}/rotate-key`,
      headers: auth(owner.accessToken),
    });
    expect(rotateRes.statusCode).toBe(201);
    const newKey = (rotateRes.json() as { apiKey: string | null }).apiKey as string;
    expect(newKey).not.toBe(oldKey);

    const oldRes = await app.inject({
      method: 'GET',
      url: '/v1/capacity',
      headers: { authorization: `Bearer ${oldKey}` },
    });
    expect(oldRes.statusCode).toBe(401);
    const newRes = await app.inject({
      method: 'GET',
      url: '/v1/capacity',
      headers: { authorization: `Bearer ${newKey}` },
    });
    expect(newRes.statusCode).toBe(200);
  });

  it('rejects a private-range webhook URL at partner registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/capacity/partners',
      headers: auth(owner.accessToken),
      payload: {
        name: 'SSRF Partner',
        deliveryMode: 'webhook',
        webhookUrl: 'https://169.254.169.254/latest/meta-data',
        classVisibility: ['light'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('capacity_webhook_url_forbidden');
  });
});
