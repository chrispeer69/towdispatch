import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
/**
 * Auth integration test. Boots a full Nest+Fastify app against the docker
 * stack (Postgres, Redis, Mailhog) and exercises every flow that ships in
 * Session 2.0:
 *
 *   - Signup creates tenant + owner + verification token (and queues email)
 *   - Login with correct credentials returns tokens
 *   - Login with wrong password fails AND increments failed_login_count
 *   - 5 failed logins lock the account for 15 minutes
 *   - Refresh rotates the token and revokes the previous one
 *   - Reusing a revoked refresh token revokes ALL the user's sessions
 *   - Forgot-password always returns 200, regardless of email existence
 *   - Reset-password works with a valid token, fails with a used token
 *   - Email verification toggles emailVerifiedAt
 *   - /auth/me requires a valid token; returns 401 without one
 *   - Cross-tenant attempts are blocked by RLS even with a forged tenant claim
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter.js';
import { registerRequestContext } from '../../src/common/middleware/request-context.middleware.js';
import { ZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../../src/config/config.service.js';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const skip = !ADMIN_URL || !APP_URL || !REDIS_URL;
const describeIfDb = skip ? describe.skip : describe;

const SUFFIX = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

interface SignupBody {
  tenantName: string;
  tenantSlug: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
}

interface AuthedResp {
  status: 'authenticated';
  user: { id: string; email: string };
  tenant: { id: string; slug: string };
  accessToken: string;
  refreshToken: string;
}

describeIfDb('Auth integration', () => {
  let app: NestFastifyApplication;
  let admin: Pool;
  let redis: Redis;

  // Tenants/users created during the test, captured so afterAll can clean up.
  const createdTenantSlugs: string[] = [];
  const createdEmails: string[] = [];

  const post = async (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
    });

  const get = async (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  const newSignupBody = (overrides: Partial<SignupBody> = {}): SignupBody => {
    const slug = `int-${SUFFIX}-${createdTenantSlugs.length}`;
    const email = `owner-${SUFFIX}-${createdTenantSlugs.length}@auth.test`;
    createdTenantSlugs.push(slug);
    createdEmails.push(email);
    return {
      tenantName: `Acme ${slug}`,
      tenantSlug: slug,
      ownerName: 'Owner Tester',
      ownerEmail: email,
      password: 'CorrectHorse-Battery-9!',
      ...overrides,
    };
  };

  beforeAll(async () => {
    process.env.NODE_ENV ??= 'test';
    process.env.LOG_LEVEL ??= 'warn';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-32-chars-long';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-at-least-32-chars-long';
    process.env.JWT_MFA_SECRET ??= 'test-mfa-secret-with-at-least-32-chars-long';
    process.env.TOTP_ENCRYPTION_KEY ??= 'test-totp-encryption-key-32+-chars-long';
    // The shared throttler default is per-IP and shared across the test
    // run; bump it so a busy auth.spec.ts does not 429 itself.
    process.env.RATE_LIMIT_BURST_LIMIT = process.env.RATE_LIMIT_BURST_LIMIT ?? '5000';
    process.env.RATE_LIMIT_SUSTAINED_LIMIT = process.env.RATE_LIMIT_SUSTAINED_LIMIT ?? '50000';

    admin = new Pool({ connectionString: ADMIN_URL!, max: 2 });
    redis = new Redis(REDIS_URL!);

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    const config = app.get(ConfigService);
    registerRequestContext(app.getHttpAdapter().getInstance());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter(config));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    // Clear redis rate-limit counters between tests so per-email caps don't
    // leak across cases (e.g. the 5-failed-logins test hits the per-email
    // 5/15m limit otherwise).
    await redis.flushdb();
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        if (createdEmails.length) {
          await c.query(
            `DELETE FROM email_verification_tokens
             WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
            [createdEmails],
          );
          await c.query(
            `DELETE FROM password_reset_tokens
             WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
            [createdEmails],
          );
          await c.query(
            `DELETE FROM sessions
             WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
            [createdEmails],
          );
          await c.query('DELETE FROM users WHERE email = ANY($1::text[])', [createdEmails]);
        }
        if (createdTenantSlugs.length) {
          // The audit trigger on tenants fires AFTER DELETE and inserts a row
          // referencing the just-deleted tenant id, which then violates the
          // tenant FK. For test cleanup we drop the rows that already exist,
          // disable the trigger for the tenant delete, then re-enable.
          await c.query(
            'DELETE FROM audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ANY($1::text[]))',
            [createdTenantSlugs],
          );
          await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
          try {
            await c.query('DELETE FROM tenants WHERE slug = ANY($1::text[])', [createdTenantSlugs]);
          } finally {
            await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
          }
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
      await admin.end();
    }
    if (redis) await redis.quit();
    if (app) await app.close();
  });

  // ----------------------------------------------------------------------- //
  it('signup creates tenant + owner + verification token', async () => {
    const body = newSignupBody();
    const res = await post('/auth/signup', body);
    expect(res.statusCode).toBe(201);
    const data = res.json() as AuthedResp;
    expect(data.status).toBe('authenticated');
    expect(data.tenant.slug).toBe(body.tenantSlug);
    expect(data.user.email).toBe(body.ownerEmail);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');

    // Verification token row was created.
    const c = await admin.connect();
    try {
      const rows = await c.query<{ count: string }>(
        'SELECT COUNT(*)::text as count FROM email_verification_tokens WHERE user_id = $1',
        [data.user.id],
      );
      expect(Number(rows.rows[0]?.count)).toBe(1);

      const userRow = await c.query<{ email_verified_at: Date | null }>(
        'SELECT email_verified_at FROM users WHERE id = $1',
        [data.user.id],
      );
      expect(userRow.rows[0]?.email_verified_at).toBeNull();
    } finally {
      c.release();
    }
  });

  // ----------------------------------------------------------------------- //
  it('login with correct credentials returns tokens', async () => {
    const body = newSignupBody();
    await post('/auth/signup', body);
    const res = await post('/auth/login', { email: body.ownerEmail, password: body.password });
    expect(res.statusCode).toBe(200);
    const data = res.json() as AuthedResp;
    expect(data.status).toBe('authenticated');
    expect(data.tenant.slug).toBe(body.tenantSlug);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
  });

  // ----------------------------------------------------------------------- //
  it('login with wrong password fails and increments failed_login_count', async () => {
    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;
    await redis.flushdb();
    const res = await post('/auth/login', { email: body.ownerEmail, password: 'wrong-password!1' });
    expect(res.statusCode).toBe(401);
    const c = await admin.connect();
    try {
      const r = await c.query<{ failed_login_count: number }>(
        'SELECT failed_login_count FROM users WHERE id = $1',
        [signup.user.id],
      );
      expect(r.rows[0]?.failed_login_count).toBe(1);
    } finally {
      c.release();
    }
  });

  // ----------------------------------------------------------------------- //
  it('5 failed logins lock the account for 15 minutes', async () => {
    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;
    await redis.flushdb();
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await post('/auth/login', { email: body.ownerEmail, password: `wrong-${i}!Aa` });
    }
    const c = await admin.connect();
    try {
      const r = await c.query<{ failed_login_count: number; locked_until: Date | null }>(
        'SELECT failed_login_count, locked_until FROM users WHERE id = $1',
        [signup.user.id],
      );
      expect(r.rows[0]?.failed_login_count).toBeGreaterThanOrEqual(5);
      expect(r.rows[0]?.locked_until).not.toBeNull();
      const lockedUntil = r.rows[0]?.locked_until?.getTime() ?? 0;
      const expected = Date.now() + 15 * 60 * 1000;
      expect(Math.abs(lockedUntil - expected)).toBeLessThan(60 * 1000);
    } finally {
      c.release();
    }

    // Even with the correct password, login is blocked while locked.
    const res = await post('/auth/login', { email: body.ownerEmail, password: body.password });
    expect(res.statusCode).toBe(403);
  });

  // ----------------------------------------------------------------------- //
  it('refresh rotates the token and revokes the previous session', async () => {
    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;
    const r1 = await post('/auth/refresh', { refreshToken: signup.refreshToken });
    expect(r1.statusCode).toBe(200);
    const rotated = r1.json() as { accessToken: string; refreshToken: string };
    expect(rotated.refreshToken).not.toBe(signup.refreshToken);

    // Original refresh token is now revoked → second refresh with it triggers
    // theft detection (token reuse).
    const r2 = await post('/auth/refresh', { refreshToken: signup.refreshToken });
    expect(r2.statusCode).toBe(401);
    expect(r2.json()).toMatchObject({ code: 'token_reused' });
  });

  // ----------------------------------------------------------------------- //
  it("reusing a revoked refresh token revokes ALL of the user's sessions", async () => {
    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;
    // Open a second active session by logging in again.
    await redis.flushdb();
    const second = (
      await post('/auth/login', { email: body.ownerEmail, password: body.password })
    ).json() as AuthedResp;
    expect(second.refreshToken).not.toBe(signup.refreshToken);

    // Rotate the original token, then replay it — should burn down everything.
    await post('/auth/refresh', { refreshToken: signup.refreshToken });
    const replay = await post('/auth/refresh', { refreshToken: signup.refreshToken });
    expect(replay.statusCode).toBe(401);

    // The second session token should also now be revoked.
    const third = await post('/auth/refresh', { refreshToken: second.refreshToken });
    expect(third.statusCode).toBe(401);

    const c = await admin.connect();
    try {
      const r = await c.query<{ active: string }>(
        'SELECT COUNT(*)::text AS active FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [signup.user.id],
      );
      expect(Number(r.rows[0]?.active)).toBe(0);
    } finally {
      c.release();
    }
  });

  // ----------------------------------------------------------------------- //
  it('forgot-password always returns 200 regardless of email existence', async () => {
    const r1 = await post('/auth/forgot-password', { email: 'no-such-user@auth.test' });
    expect(r1.statusCode).toBe(200);
    const r2 = await post('/auth/forgot-password', {
      email: createdEmails[0] ?? 'fallback@auth.test',
    });
    expect(r2.statusCode).toBe(200);
  });

  // ----------------------------------------------------------------------- //
  it('reset-password works with a valid token, fails when used twice', async () => {
    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;

    const c = await admin.connect();
    let token: string;
    try {
      // The forgot-password endpoint persists a hashed token. We mint a fresh
      // plain token directly + insert it so the test owns the round-trip.
      token = `${SUFFIX}-${signup.user.id.slice(0, 8)}-reset`;
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await c.query(
        `INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '1 hour')`,
        [signup.tenant.id, signup.user.id, tokenHash],
      );
    } finally {
      c.release();
    }

    const r1 = await post('/auth/reset-password', { token, newPassword: 'NewSafe-Password-12!' });
    expect(r1.statusCode).toBe(200);

    // Second use of the same token must be rejected.
    const r2 = await post('/auth/reset-password', { token, newPassword: 'OtherSafe-Password-9!' });
    expect(r2.statusCode).toBe(400);

    // Old password no longer works; new one does.
    await redis.flushdb();
    const oldLogin = await post('/auth/login', { email: body.ownerEmail, password: body.password });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await post('/auth/login', {
      email: body.ownerEmail,
      password: 'NewSafe-Password-12!',
    });
    expect(newLogin.statusCode).toBe(200);
  });

  // ----------------------------------------------------------------------- //
  it('email verification toggles emailVerifiedAt', async () => {
    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;

    const c = await admin.connect();
    let plain: string;
    try {
      plain = `${SUFFIX}-${signup.user.id.slice(0, 8)}-verify`;
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(plain).digest('hex');
      // Replace any existing token with our known one so we can exercise
      // the consume path deterministically.
      await c.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [signup.user.id]);
      await c.query(
        `INSERT INTO email_verification_tokens (id, tenant_id, user_id, token_hash, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '24 hours')`,
        [signup.tenant.id, signup.user.id, tokenHash],
      );
    } finally {
      c.release();
    }

    const r = await post('/auth/verify-email', { token: plain });
    expect(r.statusCode).toBe(200);

    const c2 = await admin.connect();
    try {
      const row = await c2.query<{ email_verified_at: Date | null }>(
        'SELECT email_verified_at FROM users WHERE id = $1',
        [signup.user.id],
      );
      expect(row.rows[0]?.email_verified_at).not.toBeNull();
    } finally {
      c2.release();
    }
  });

  // ----------------------------------------------------------------------- //
  it('/auth/me requires a valid token', async () => {
    const noAuth = await get('/auth/me');
    expect(noAuth.statusCode).toBe(401);

    const body = newSignupBody();
    const signup = (await post('/auth/signup', body)).json() as AuthedResp;
    const ok = await get('/auth/me', { authorization: `Bearer ${signup.accessToken}` });
    expect(ok.statusCode).toBe(200);
    const me = ok.json() as { user: { id: string }; tenant: { id: string }; permissions: string[] };
    expect(me.user.id).toBe(signup.user.id);
    expect(me.tenant.id).toBe(signup.tenant.id);
    expect(Array.isArray(me.permissions)).toBe(true);
  });

  // ----------------------------------------------------------------------- //
  it('cross-tenant token forgery is rejected (token signed with tid for tenant B cannot read tenant A data)', async () => {
    // Spin up two tenants.
    const a = newSignupBody();
    const b = newSignupBody();
    const aSign = (await post('/auth/signup', a)).json() as AuthedResp;
    const bSign = (await post('/auth/signup', b)).json() as AuthedResp;

    // Forge an access token: claims say (sub=userA, tid=tenantB). The forgery
    // is signed with the SAME secret so the JWT signature passes — that's the
    // worst-case scenario where a leaked secret is reused.
    const accessSecret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
    const forged = await new SignJWT({
      sub: aSign.user.id,
      tid: bSign.tenant.id,
      role: 'owner',
      jti: '00000000-0000-0000-0000-000000000000',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(process.env.JWT_ISSUER ?? 'ustowdispatch')
      .setAudience(process.env.JWT_AUDIENCE ?? 'ustowdispatch-api')
      .setExpirationTime('5m')
      .sign(accessSecret);

    // /auth/me looks up the user by id (admin pool, not RLS-bound). Even
    // though the token's tid says B, the user id resolves to tenant A. We
    // assert that the ME response reflects userA's actual tenantA, NOT the
    // forged tid — proving claims are cross-checked rather than trusted.
    const me = await get('/auth/me', { authorization: `Bearer ${forged}` });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { user: { id: string }; tenant: { id: string } };
    expect(body.user.id).toBe(aSign.user.id);
    expect(body.tenant.id).toBe(aSign.tenant.id);
    expect(body.tenant.id).not.toBe(bSign.tenant.id);

    // Now confirm RLS would also block direct cross-tenant DB reads from the
    // app pool: open a tx with current_tenant_id=B and try to read tenant A's
    // session row. Should return zero rows.
    const appPool = new Pool({ connectionString: APP_URL!, max: 1 });
    try {
      const c = await appPool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [bSign.tenant.id]);
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [bSign.user.id]);
        const rows = await c.query('SELECT id FROM sessions WHERE user_id = $1', [aSign.user.id]);
        expect(rows.rows).toHaveLength(0);
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    } finally {
      await appPool.end();
    }
  });
});
