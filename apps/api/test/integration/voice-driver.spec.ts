/**
 * Voice-Controlled Driver Workflows (Session 45) — API integration.
 *
 * Boots the full app and drives /voice-driver/command over a real driver
 * JWT against a real DB, proving the voice layer maps onto the EXISTING
 * job-status transitions and that the spoken-confirmation gate works
 * end-to-end (decline → "confirm?" → "yes" → cancelled).
 *
 * Skips the whole file when DATABASE_URL / REDIS_URL aren't set — matches
 * the skipIfNoDb pattern used by every other integration spec.
 */
// VOICE_DRIVER_ENABLED defaults false; turn it on before bootApp reads env.
process.env.VOICE_DRIVER_ENABLED = 'true';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@ustowdispatch/db';
import type { VoiceCommandResponse } from '@ustowdispatch/shared';
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

const SUFFIX = `voice-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Voice Driver (Session 45) — API integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp;
  let driverId: string;
  let jobA: string;
  let jobB: string;
  let driverToken: string;

  async function jobStatus(id: string): Promise<string> {
    const c = await ctx.admin.connect();
    try {
      const r = await c.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1::uuid', [
        id,
      ]);
      return r.rows[0]?.status ?? 'missing';
    } finally {
      c.release();
    }
  }

  function speak(transcript: string, jobId?: string) {
    return app.inject({
      method: 'POST',
      url: '/voice-driver/command',
      headers: { ...auth(driverToken), 'content-type': 'application/json' },
      payload: { transcript, platform: 'web', locale: 'en', ...(jobId ? { jobId } : {}) },
    });
  }

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));

    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      driverId = uuidv7();
      await c.query(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, cdl_class, active)
         VALUES ($1::uuid, $2::uuid, 'Voice', 'Driver', 'A', true)`,
        [driverId, owner.tenant.id],
      );
      jobA = uuidv7();
      jobB = uuidv7();
      // Both dispatched + assigned to the driver → two active jobs.
      for (const [id, n] of [
        [jobA, '1'],
        [jobB, '2'],
      ] as const) {
        await c.query(
          `INSERT INTO jobs
             (id, tenant_id, job_number, status, service_type, pickup_address, dropoff_address, authorized_by, assigned_driver_id, assigned_at)
           VALUES ($1::uuid, $2::uuid, $3, 'dispatched', 'tow', '1 Spec Lane', '99 Yard Rd', 'customer', $4::uuid, now())`,
          [id, owner.tenant.id, `20990101-9${Date.now().toString().slice(-3)}${n}`, driverId],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }

    // Operator sets a PIN; driver logs in for a driver JWT.
    await app.inject({
      method: 'POST',
      url: '/driver-auth/set-pin',
      headers: { ...auth(owner.accessToken), 'content-type': 'application/json' },
      payload: { driverId, pin: '1234' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/driver-auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { driverId, pin: '1234', tenantSlug: owner.tenant.slug },
    });
    driverToken = (loginRes.json() as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('maps "on my way" then "on scene" onto the real job transitions', async () => {
    const r1 = await speak('on my way', jobA);
    expect(r1.statusCode).toBe(201);
    const b1 = r1.json() as VoiceCommandResponse;
    expect(b1.recognizedIntent).toBe('en_route');
    expect(b1.actionExecuted).toBe(true);
    expect(b1.jobStatus).toBe('enroute');
    expect(b1.responseText.length).toBeGreaterThan(0);
    expect(await jobStatus(jobA)).toBe('enroute');

    const r2 = await speak("I'm on scene", jobA);
    const b2 = r2.json() as VoiceCommandResponse;
    expect(b2.recognizedIntent).toBe('arrive_on_scene');
    expect(b2.actionExecuted).toBe(true);
    expect(b2.jobStatus).toBe('on_scene');
    expect(await jobStatus(jobA)).toBe('on_scene');
  });

  it('rejects an illegal transition with a spoken explanation, no crash', async () => {
    // jobB is still 'dispatched'; "loaded" wants in_progress, which is illegal
    // from dispatched. Should not 500, should not move the job.
    const r = await speak('the vehicle is loaded', jobB);
    expect(r.statusCode).toBe(201);
    const b = r.json() as VoiceCommandResponse;
    expect(b.actionExecuted).toBe(false);
    expect(b.responseText.length).toBeGreaterThan(0);
    expect(await jobStatus(jobB)).toBe('dispatched');
  });

  it('asks the driver to pick a job when more than one is active and no jobId is given', async () => {
    const r = await speak('on my way'); // no jobId; jobA(on_scene) + jobB(dispatched) both active
    const b = r.json() as VoiceCommandResponse;
    expect(b.actionExecuted).toBe(false);
    expect(b.jobId).toBeNull();
  });

  it('gates a destructive intent behind a spoken confirmation', async () => {
    // Turn 1: decline → queued, NOT executed.
    const r1 = await speak('decline this job because customer left', jobB);
    const b1 = r1.json() as VoiceCommandResponse;
    expect(b1.recognizedIntent).toBe('decline_job');
    expect(b1.confirmationRequired).toBe(true);
    expect(b1.actionExecuted).toBe(false);
    expect(b1.followUpQuestion).toBeTruthy();
    expect(await jobStatus(jobB)).toBe('dispatched'); // still not cancelled

    // Turn 2: "yes" → executes the queued decline (no jobId needed).
    const r2 = await speak('yes');
    const b2 = r2.json() as VoiceCommandResponse;
    expect(b2.actionExecuted).toBe(true);
    expect(await jobStatus(jobB)).toBe('cancelled');
  });

  it('"no" cancels a queued destructive action', async () => {
    // jobA is on_scene (active). Queue a clear, then decline the confirmation.
    const r1 = await speak('clear the job', jobA);
    expect((r1.json() as VoiceCommandResponse).confirmationRequired).toBe(true);

    const r2 = await speak('no');
    const b2 = r2.json() as VoiceCommandResponse;
    expect(b2.actionExecuted).toBe(false);
    expect(await jobStatus(jobA)).toBe('on_scene'); // not completed
  });

  it('reads back the pickup address on repeat_address', async () => {
    const r = await speak('what is the address', jobA);
    const b = r.json() as VoiceCommandResponse;
    expect(b.recognizedIntent).toBe('repeat_address');
    expect(b.responseText).toContain('1 Spec Lane');
  });

  it('downgrades an unrecognized utterance to clarify', async () => {
    const r = await speak('mumble wakka wakka', jobA);
    const b = r.json() as VoiceCommandResponse;
    expect(b.recognizedIntent).toBe('clarify');
    expect(b.actionExecuted).toBe(false);
  });
});
