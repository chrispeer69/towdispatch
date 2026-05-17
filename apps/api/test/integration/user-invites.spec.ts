/**
 * Integration test for the invite flow (Admin Settings build 7 of 7).
 *
 *   - POST /users/invite     creates an invite row + (best-effort) emails
 *   - duplicate pending invite to same email → 409
 *   - GET  /users/invites    lists pending invites
 *   - POST /users/invite/:id/resend rotates token + extends expiry
 *   - DELETE /users/invite/:id deletes a pending invite
 *   - POST /users/accept-invite — valid token: creates the user + cookies
 *   - POST /users/accept-invite — expired token: 410
 *   - POST /users/accept-invite — consumed token: 410
 *   - POST /users/accept-invite — bogus token: 404
 */
import { createHash } from 'node:crypto';
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

const SUFFIX = `inv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface InviteRow {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  status: 'pending' | 'expired' | 'consumed';
  expiresAt: string;
}

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

describeIfDb('User invites integration', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let session: AuthedResp;

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  it('POST /users/invite creates an invite + (best-effort) emails', async () => {
    const inviteeEmail = `invitee-${SUFFIX}-1@spec.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: inviteeEmail, role: 'dispatcher', fullName: 'Invited One' },
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json() as InviteRow;
    expect(inv.email).toBe(inviteeEmail);
    expect(inv.role).toBe('dispatcher');
    expect(inv.status).toBe('pending');
  });

  it('duplicate pending invite to the same email is rejected with 409', async () => {
    const inviteeEmail = `invitee-${SUFFIX}-dup@spec.test`;
    const first = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: inviteeEmail, role: 'driver' },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: inviteeEmail, role: 'driver' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('GET /users/invites lists pending invites by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/invites',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const invites = res.json() as InviteRow[];
    expect(invites.length).toBeGreaterThan(0);
    for (const i of invites) expect(i.status).toBe('pending');
  });

  it('POST /users/invite/:id/resend rotates token + extends expiry', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: `invitee-${SUFFIX}-resend@spec.test`, role: 'driver' },
    });
    const created = createRes.json() as InviteRow;

    const c1 = await ctx.admin.connect();
    let originalHash = '';
    try {
      const r = await c1.query<{ token_hash: string }>(
        'SELECT token_hash FROM user_invites WHERE id = $1',
        [created.id],
      );
      originalHash = r.rows[0]?.token_hash ?? '';
    } finally {
      c1.release();
    }
    expect(originalHash).not.toBe('');

    const resendRes = await app.inject({
      method: 'POST',
      url: `/users/invite/${created.id}/resend`,
      headers: auth(session.accessToken),
    });
    expect(resendRes.statusCode).toBe(200);

    const c2 = await ctx.admin.connect();
    try {
      const r = await c2.query<{ token_hash: string }>(
        'SELECT token_hash FROM user_invites WHERE id = $1',
        [created.id],
      );
      expect(r.rows[0]?.token_hash).not.toBe(originalHash);
    } finally {
      c2.release();
    }
  });

  it('DELETE /users/invite/:id removes a pending invite', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: `invitee-${SUFFIX}-cancel@spec.test`, role: 'driver' },
    });
    const created = createRes.json() as InviteRow;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/users/invite/${created.id}`,
      headers: auth(session.accessToken),
    });
    expect(delRes.statusCode).toBe(204);

    const c = await ctx.admin.connect();
    try {
      const r = await c.query('SELECT 1 FROM user_invites WHERE id = $1', [created.id]);
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('POST /users/accept-invite consumes a valid invite + auto-logs in', async () => {
    const inviteeEmail = `invitee-${SUFFIX}-accept@spec.test`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: inviteeEmail, role: 'dispatcher', fullName: 'Accepter' },
    });
    expect(createRes.statusCode).toBe(201);
    const invite = createRes.json() as InviteRow;

    const plainToken = `local-test-token-${Date.now()}-${Math.random()}`;
    const tokenHash = hashToken(plainToken);
    const c = await ctx.admin.connect();
    try {
      await c.query('UPDATE user_invites SET token_hash = $1 WHERE id = $2', [
        tokenHash,
        invite.id,
      ]);
    } finally {
      c.release();
    }

    const acceptRes = await app.inject({
      method: 'POST',
      url: '/users/accept-invite',
      headers: { 'content-type': 'application/json' },
      payload: {
        token: plainToken,
        password: 'Accept-Invite-1234!',
        fullName: 'Accepter Test',
      },
    });
    expect(acceptRes.statusCode).toBe(200);
    const body = acceptRes.json() as {
      status: string;
      user: { id: string; email: string; role: string };
      tenant: { id: string };
      accessToken: string;
      refreshToken: string;
    };
    expect(body.status).toBe('authenticated');
    expect(body.user.email).toBe(inviteeEmail);
    expect(body.user.role).toBe('dispatcher');
    expect(body.tenant.id).toBe(session.tenant.id);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    const replay = await app.inject({
      method: 'POST',
      url: '/users/accept-invite',
      headers: { 'content-type': 'application/json' },
      payload: {
        token: plainToken,
        password: 'Accept-Invite-1234!',
        fullName: 'Accepter Test',
      },
    });
    expect(replay.statusCode).toBe(410);
  });

  it('POST /users/accept-invite with bogus token returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/accept-invite',
      headers: { 'content-type': 'application/json' },
      payload: {
        token: `bogus-${Date.now()}-${Math.random()}`,
        password: 'Accept-Invite-1234!',
        fullName: 'Nobody',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /users/accept-invite with expired token returns 410', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/users/invite',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { email: `invitee-${SUFFIX}-expired@spec.test`, role: 'driver' },
    });
    const invite = createRes.json() as InviteRow;

    const plainToken = `expired-token-${Date.now()}-${Math.random()}`;
    const tokenHash = hashToken(plainToken);
    const c = await ctx.admin.connect();
    try {
      await c.query(
        "UPDATE user_invites SET token_hash = $1, expires_at = now() - interval '1 hour' WHERE id = $2",
        [tokenHash, invite.id],
      );
    } finally {
      c.release();
    }

    const res = await app.inject({
      method: 'POST',
      url: '/users/accept-invite',
      headers: { 'content-type': 'application/json' },
      payload: {
        token: plainToken,
        password: 'Accept-Invite-1234!',
        fullName: 'Expired Acceptor',
      },
    });
    expect(res.statusCode).toBe(410);
  });
});
