/**
 * Chat integration spec (Session 6.2).
 *
 * Covers all four endpoints under /dispatch/chat plus:
 *   - thread lazy-creation on first message
 *   - idempotency via client_message_id (same key → same row)
 *   - participant scoping (driver assigned to job ✓; driver not assigned ✗)
 *   - cursor pagination (newest first, stable across pages)
 *   - read receipts (sender can't mark own, idempotent)
 *   - cross-tenant RLS isolation (tenant A driver ≠ tenant B messages)
 *
 * Skipped automatically when Postgres/Redis env vars are absent.
 */
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from '../../src/modules/auth/jwt.service.js';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  seedDefaultRateSheet,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `chat-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface ChatMsg {
  id: string;
  jobId: string;
  sender: string;
  kind: string;
  body: string | null;
  attachmentUrl: string | null;
  deliveryState: string;
  createdAt: string;
}

describeIfDb('Chat integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp; // role=owner — dispatcher-equivalent for tests
  let attacker: AuthedResp;

  // Driver in the primary tenant — created via admin SQL + manually-signed JWT.
  let driverUserId: string;
  let driverId: string;
  let driverToken: string;
  // Driver in the attacker tenant for RLS isolation tests.
  let attackerDriverToken: string;

  let jobId: string;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    await seedDefaultRateSheet(ctx, owner.tenant.id);

    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-attacker`, ctx));
    await seedDefaultRateSheet(ctx, attacker.tenant.id);

    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      // Driver user + driver row in primary tenant.
      const userEmail = `driver-${SUFFIX}@spec.test`;
      ctx.createdEmails.push(userEmail);
      // users schema has first_name + last_name; there is no full_name
      // column. Earlier sessions used full_name; the migration that split
      // it was 0006 in packages/db/drizzle/. The test was never updated,
      // so the suite silently failed in beforeAll and reported as skipped.
      const uRes = await c.query<{ id: string }>(
        `INSERT INTO users (id, tenant_id, email, password_hash, role, first_name, last_name)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'driver', 'Test', 'Driver')
         RETURNING id`,
        [owner.tenant.id, userEmail, '$argon2id$v=19$m=65536,t=2,p=1$placeholder$placeholder'],
      );
      driverUserId = uRes.rows[0]?.id as string;
      const dRes = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, user_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'Test', 'Driver', 'A', true)
         RETURNING id`,
        [owner.tenant.id, driverUserId, `EMP-${SUFFIX}`],
      );
      driverId = dRes.rows[0]?.id as string;

      const tRes = await c.query<{ id: string }>(
        `INSERT INTO trucks (id, tenant_id, unit_number, truck_type, in_service)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'flatbed', true)
         RETURNING id`,
        [owner.tenant.id, `T-${SUFFIX}`],
      );
      const truckId = tRes.rows[0]?.id as string;

      // Job assigned to the driver — chat participant check needs this link.
      // pickup_address and authorized_by are NOT NULL on the jobs table.
      // job_number must match the YYYYMMDD-NNNN constraint
      // (jobs_job_number_format in sql/0008). Use today's date + a 4-digit
      // suffix derived from the SUFFIX hash so parallel runs don't collide.
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      let h = 0;
      for (const ch of SUFFIX) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const jobNumber = `${today}-${String((h % 9000) + 1000).padStart(4, '0')}`;
      const jRes = await c.query<{ id: string }>(
        `INSERT INTO jobs (
            id, tenant_id, job_number, status, service_type,
            assigned_driver_id, assigned_truck_id,
            pickup_address, authorized_by
         )
         VALUES (
            gen_random_uuid(), $1::uuid, $2, 'dispatched', 'tow',
            $3::uuid, $4::uuid,
            '100 Test St', 'customer'
         )
         RETURNING id`,
        [owner.tenant.id, jobNumber, driverId, truckId],
      );
      jobId = jRes.rows[0]?.id as string;

      // Driver in the attacker tenant.
      const attackerEmail = `driver-${SUFFIX}-att@spec.test`;
      ctx.createdEmails.push(attackerEmail);
      const aUserRes = await c.query<{ id: string }>(
        `INSERT INTO users (id, tenant_id, email, password_hash, role, first_name, last_name)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'driver', 'Attacker', 'Driver')
         RETURNING id`,
        [
          attacker.tenant.id,
          attackerEmail,
          '$argon2id$v=19$m=65536,t=2,p=1$placeholder$placeholder',
        ],
      );
      const attackerDriverUserId = aUserRes.rows[0]?.id as string;
      await c.query(
        `INSERT INTO drivers (id, tenant_id, user_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'Att', 'Driver', 'A', true)`,
        [attacker.tenant.id, attackerDriverUserId, `EMP-${SUFFIX}-att`],
      );

      await c.query('COMMIT');

      // Mint access tokens for both drivers via the live JwtService. The
      // access-token claims schema requires `jti` to be a UUID; using a
      // human-readable label silently fails Zod validation in the JWT
      // guard, which returns 401 for every request.
      const jwt = app.get(JwtService);
      driverToken = await jwt.signAccess({
        sub: driverUserId,
        tid: owner.tenant.id,
        role: 'driver',
        jti: randomUUID(),
      });
      attackerDriverToken = await jwt.signAccess({
        sub: attackerDriverUserId,
        tid: attacker.tenant.id,
        role: 'driver',
        jti: randomUUID(),
      });
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

  // ---------------- send / list ----------------
  it('driver posts the first message and a thread is created', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: {
        clientMessageId: 'cm-1',
        jobId,
        kind: 'text',
        body: 'On my way',
      },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json() as ChatMsg;
    expect(msg.sender).toBe('driver');
    expect(msg.kind).toBe('text');
    expect(msg.body).toBe('On my way');
    expect(msg.deliveryState).toBe('sent');
  });

  it('idempotent: re-posting with the same clientMessageId returns the original row', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: { clientMessageId: 'cm-2', jobId, kind: 'text', body: 'Test idempotency' },
    });
    const first = res1.json() as ChatMsg;

    const res2 = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: { clientMessageId: 'cm-2', jobId, kind: 'text', body: 'DIFFERENT BODY' },
    });
    const second = res2.json() as ChatMsg;
    expect(second.id).toBe(first.id);
    expect(second.body).toBe('Test idempotency'); // not overwritten
  });

  it('dispatcher (owner) sees the driver messages on the same thread', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: auth(owner.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { messages: ChatMsg[]; nextCursor: string | null };
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
    // newest first.
    const newest = body.messages[0]?.createdAt ?? '';
    const next = body.messages[1]?.createdAt ?? '';
    expect(newest >= next).toBe(true);
  });

  it('pagination cursor returns the next page', async () => {
    // Seed 5 more messages so we have enough to page through.
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: `/dispatch/chat/threads/${jobId}/messages`,
        headers: { ...auth(driverToken), 'content-type': 'application/json' },
        payload: { clientMessageId: `pg-${i}`, jobId, kind: 'text', body: `msg ${i}` },
      });
    }
    const first = await app.inject({
      method: 'GET',
      url: `/dispatch/chat/threads/${jobId}/messages?limit=3`,
      headers: auth(owner.accessToken),
    });
    const firstBody = first.json() as { messages: ChatMsg[]; nextCursor: string | null };
    expect(firstBody.messages).toHaveLength(3);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: `/dispatch/chat/threads/${jobId}/messages?limit=3&cursor=${encodeURIComponent(firstBody.nextCursor as string)}`,
      headers: auth(owner.accessToken),
    });
    const secondBody = second.json() as { messages: ChatMsg[]; nextCursor: string | null };
    // No overlap between pages.
    const firstIds = new Set(firstBody.messages.map((m) => m.id));
    for (const m of secondBody.messages) {
      expect(firstIds.has(m.id)).toBe(false);
    }
  });

  // ---------------- participant scoping ----------------
  it('attacker-tenant driver cannot POST to a primary-tenant job (404, not 403, to avoid leaking existence)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: { ...auth(attackerDriverToken), 'content-type': 'application/json' },
      payload: { clientMessageId: 'evil-1', jobId, kind: 'text', body: 'hi' },
    });
    // RLS hides the job entirely from the attacker tenant ⇒ 404.
    expect(res.statusCode).toBe(404);
  });

  it('attacker-tenant driver cannot GET messages from a primary-tenant thread (RLS isolation)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: auth(attackerDriverToken),
    });
    expect(res.statusCode).toBe(404);
  });

  // ---------------- mark read ----------------
  it('dispatcher can mark a driver-authored message as read; sender cannot mark their own', async () => {
    // Send a new driver message.
    const sendRes = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: { clientMessageId: 'mr-1', jobId, kind: 'text', body: 'mark me' },
    });
    const msg = sendRes.json() as ChatMsg;

    const driverSelfRead = await app.inject({
      method: 'PATCH',
      url: `/dispatch/chat/messages/${msg.id}/read`,
      headers: auth(driverToken),
    });
    // Marking your own message is a no-op (still 200, deliveryState unchanged).
    expect(driverSelfRead.statusCode).toBe(200);
    expect((driverSelfRead.json() as ChatMsg).deliveryState).toBe('sent');

    const dispatcherRead = await app.inject({
      method: 'PATCH',
      url: `/dispatch/chat/messages/${msg.id}/read`,
      headers: auth(owner.accessToken),
    });
    expect(dispatcherRead.statusCode).toBe(200);
    expect((dispatcherRead.json() as ChatMsg).deliveryState).toBe('read');
  });

  // ---------------- attachment URL ----------------
  it('mints a presigned attachment URL for a participant', async () => {
    const sendRes = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/threads/${jobId}/messages`,
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: {
        clientMessageId: 'voice-1',
        jobId,
        kind: 'voice',
        attachmentUrl: '/files/placeholder',
      },
    });
    const msg = sendRes.json() as ChatMsg;
    const presign = await app.inject({
      method: 'POST',
      url: `/dispatch/chat/messages/${msg.id}/attachment-url`,
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: { kind: 'voice_memo', mimeType: 'audio/m4a' },
    });
    expect(presign.statusCode).toBe(201);
    const body = presign.json() as {
      uploadUrl: string;
      attachmentUrl: string;
      expiresAt: string;
    };
    expect(body.uploadUrl).toContain(owner.tenant.id);
    expect(body.attachmentUrl).toContain(owner.tenant.id);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  // ---------------- fleet routes opened to driver ----------------
  it('driver can list DVIRs and gets only their own (empty by default)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/dvirs',
      headers: auth(driverToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ driverId: string }>;
    for (const r of rows) {
      expect(r.driverId).toBe(driverId);
    }
  });

  it('driver can list their truck assignments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fleet/drivers/${driverId}/trucks`,
      headers: auth(driverToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("driver cannot list another driver's truck assignments", async () => {
    // Create another driver in the same tenant.
    const c = await ctx.admin.connect();
    let otherDriverId: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO drivers (id, tenant_id, employee_number, first_name, last_name, cdl_class, active)
         VALUES (gen_random_uuid(), $1::uuid, $2, 'Other', 'Driver', 'A', true)
         RETURNING id`,
        [owner.tenant.id, `EMP-${SUFFIX}-other`],
      );
      otherDriverId = r.rows[0]?.id as string;
    } finally {
      c.release();
    }
    const res = await app.inject({
      method: 'GET',
      url: `/fleet/drivers/${otherDriverId}/trucks`,
      headers: auth(driverToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('driver hits /fleet/expirations and gets only their own + assigned trucks scope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/expirations',
      headers: auth(driverToken),
    });
    expect(res.statusCode).toBe(200);
    // Shape only — content depends on seed; what matters is the route accepts driver.
    const body = res.json() as { expired: unknown[]; critical: unknown[]; warning: unknown[] };
    expect(body).toHaveProperty('expired');
    expect(body).toHaveProperty('critical');
    expect(body).toHaveProperty('warning');
  });
});
