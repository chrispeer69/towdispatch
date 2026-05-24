/**
 * Marketplace API (Session 46) — full HTTP integration: developer onboarding,
 * app review, the OAuth2 authorization-code-with-PKCE flow, scope enforcement,
 * the install/uninstall lifecycle, and cross-tenant token isolation.
 *
 * Self-skips without the docker stack (Postgres + Redis), mirroring the other
 * integration specs. Boots the real Nest app and drives it via `inject`, so the
 * guards, controllers, services, RLS, and DB triggers are all exercised.
 */
import { createHash, randomBytes } from 'node:crypto';
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

const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface PkcePair {
  verifier: string;
  challenge: string;
}
const pkce = (): PkcePair => {
  const verifier = randomBytes(48).toString('base64url'); // 64 chars, RFC-7636 range
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

const REDIRECT = 'https://app.example.com/callback';

describeIfDb('Marketplace API — OAuth2 + lifecycle', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let operator: AuthedResp;
  const createdDeveloperEmails: string[] = [];
  const createdAppIds: string[] = [];
  const tenantIds: string[] = [];

  // A listed app + its plaintext client secret, reused across cases.
  let clientId: string;
  let clientSecret: string;

  beforeAll(async () => {
    process.env.MARKETPLACE_API_ENABLED = 'true';
    process.env.MARKETPLACE_ADMIN_TOKEN =
      process.env.MARKETPLACE_ADMIN_TOKEN ?? 'test-marketplace-admin-token-1234567890';
    ctx = await makeContext();
    app = ctx.app;
    operator = await signup(ctx, makeSignupBody('mkt-op', ctx));
    tenantIds.push(operator.tenant.id);

    const built = await buildListedApp(['read:profile', 'read:jobs']);
    clientId = built.clientId;
    clientSecret = built.clientSecret;
  }, 60_000);

  afterAll(async () => {
    if (ctx?.admin) {
      const c = await ctx.admin.connect();
      try {
        if (tenantIds.length) {
          await c.query('DELETE FROM marketplace_app_events WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM marketplace_oauth_codes WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM marketplace_app_installs WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
        }
        if (createdAppIds.length) {
          await c.query('DELETE FROM marketplace_apps WHERE id = ANY($1::uuid[])', [createdAppIds]);
        }
        if (createdDeveloperEmails.length) {
          await c.query(
            'DELETE FROM developer_accounts WHERE lower(owner_user_email) = ANY($1::text[])',
            [createdDeveloperEmails.map((e) => e.toLowerCase())],
          );
        }
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  }, 60_000);

  // --- helpers ------------------------------------------------------------

  async function registerDeveloper(): Promise<string> {
    const email = `dev-${createdDeveloperEmails.length}-${Date.now()}@spec.test`;
    createdDeveloperEmails.push(email);
    const su = await app.inject({
      method: 'POST',
      url: '/developers/signup',
      headers: { 'content-type': 'application/json' },
      payload: {
        ownerUserEmail: email,
        companyName: 'Spec Devco',
        password: 'CorrectHorse-Battery-9!',
      },
    });
    expect(su.statusCode).toBe(202);
    const token = (su.json() as { devVerificationToken: string }).devVerificationToken;
    expect(token).toBeTruthy();

    const ve = await app.inject({
      method: 'POST',
      url: '/developers/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token },
    });
    expect(ve.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/developers/login',
      headers: { 'content-type': 'application/json' },
      payload: { ownerUserEmail: email, password: 'CorrectHorse-Battery-9!' },
    });
    expect(login.statusCode).toBe(200);
    return (login.json() as { accessToken: string }).accessToken;
  }

  async function buildListedApp(
    scopes: string[],
  ): Promise<{ clientId: string; clientSecret: string; devToken: string }> {
    const devToken = await registerDeveloper();
    const slug = `spec-app-${createdAppIds.length}-${Date.now().toString(36)}`;
    const create = await app.inject({
      method: 'POST',
      url: '/developers/apps',
      headers: { 'content-type': 'application/json', ...auth(devToken) },
      payload: {
        slug,
        name: 'Spec App',
        description: 'integration',
        category: 'integration',
        scopes,
        oauthRedirectUrls: [REDIRECT],
        webhookUrl: null,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      app: { id: string };
      clientId: string;
      clientSecret: string;
    };
    createdAppIds.push(created.app.id);

    // draft → review → listed
    const submit = await app.inject({
      method: 'POST',
      url: `/developers/apps/${created.app.id}/submit`,
      headers: auth(devToken),
    });
    expect(submit.statusCode).toBe(201);

    const approve = await app.inject({
      method: 'POST',
      url: `/marketplace-admin/apps/${created.app.id}/review`,
      headers: {
        'content-type': 'application/json',
        ...auth(process.env.MARKETPLACE_ADMIN_TOKEN as string),
      },
      payload: { action: 'approve' },
    });
    expect(approve.statusCode).toBe(201);
    expect((approve.json() as { status: string }).status).toBe('listed');

    return { clientId: created.clientId, clientSecret: created.clientSecret, devToken };
  }

  async function authorize(scopes: string[], challenge: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/json', ...auth(operator.accessToken) },
      payload: {
        clientId,
        redirectUri: REDIRECT,
        scopes,
        state: 'xyz',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { code: string }).code;
  }

  async function exchange(
    code: string,
    verifier: string,
  ): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/json' },
      payload: {
        grantType: 'authorization_code',
        clientId,
        clientSecret,
        code,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { accessToken: string; refreshToken: string; scope: string };
  }

  // --- cases --------------------------------------------------------------

  it('happy path: authorize → token → scope-gated /v1 access', async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(['read:profile', 'read:jobs'], challenge);
    const tokens = await exchange(code, verifier);
    expect(tokens.scope).toContain('read:jobs');

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: auth(tokens.accessToken),
    });
    expect(me.statusCode).toBe(200);
    const identity = me.json() as { tenantId: string; appSlug: string; scopes: string[] };
    expect(identity.tenantId).toBe(operator.tenant.id);
    expect(identity.scopes).toContain('read:profile');

    const jobs = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: auth(tokens.accessToken),
    });
    expect(jobs.statusCode).toBe(200);
    expect((jobs.json() as { tenantId: string }).tenantId).toBe(operator.tenant.id);
  });

  it('PKCE mismatch is rejected with oauth_invalid_grant', async () => {
    const { challenge } = pkce();
    const code = await authorize(['read:profile'], challenge);
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/json' },
      payload: {
        grantType: 'authorization_code',
        clientId,
        clientSecret,
        code,
        redirectUri: REDIRECT,
        codeVerifier: pkce().verifier, // wrong verifier
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('oauth_invalid_grant');
  });

  it('an authorization code is single-use', async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(['read:profile'], challenge);
    await exchange(code, verifier);
    const replay = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/json' },
      payload: {
        grantType: 'authorization_code',
        clientId,
        clientSecret,
        code,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      },
    });
    expect(replay.statusCode).toBe(400);
  });

  it('authorize rejects scopes the app did not declare', async () => {
    const { challenge } = pkce();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/json', ...auth(operator.accessToken) },
      payload: {
        clientId,
        redirectUri: REDIRECT,
        scopes: ['write:invoices'],
        state: 'xyz',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('oauth_invalid_scope');
  });

  it('a token missing a required scope is 403 on that route', async () => {
    // Grant only read:profile, then hit /v1/jobs (needs read:jobs).
    const { verifier, challenge } = pkce();
    const code = await authorize(['read:profile'], challenge);
    const tokens = await exchange(code, verifier);
    const jobs = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: auth(tokens.accessToken),
    });
    expect(jobs.statusCode).toBe(403);
    expect((jobs.json() as { code: string }).code).toBe('marketplace_scope_not_granted');
  });

  it('refresh rotates the token and the old refresh token stops working', async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(['read:profile'], challenge);
    const first = await exchange(code, verifier);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/json' },
      payload: {
        grantType: 'refresh_token',
        clientId,
        clientSecret,
        refreshToken: first.refreshToken,
      },
    });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json() as { accessToken: string };
    expect(second.accessToken).not.toBe(first.accessToken);

    const reuseOld = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/json' },
      payload: {
        grantType: 'refresh_token',
        clientId,
        clientSecret,
        refreshToken: first.refreshToken,
      },
    });
    expect(reuseOld.statusCode).toBe(400);
  });

  it('revocation immediately invalidates the access token', async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(['read:profile'], challenge);
    const tokens = await exchange(code, verifier);

    const revoke = await app.inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: { 'content-type': 'application/json' },
      payload: { clientId, clientSecret, token: tokens.accessToken },
    });
    expect(revoke.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: auth(tokens.accessToken),
    });
    expect(me.statusCode).toBe(401);
  });

  it('install lifecycle: operator sees and can uninstall the app', async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(['read:profile'], challenge);
    const tokens = await exchange(code, verifier);

    const listed = await app.inject({
      method: 'GET',
      url: '/apps/installed',
      headers: auth(operator.accessToken),
    });
    expect(listed.statusCode).toBe(200);
    const installs = listed.json() as Array<{ id: string; appSlug: string; status: string }>;
    const active = installs.find((i) => i.status === 'active');
    expect(active).toBeDefined();

    const uninstall = await app.inject({
      method: 'DELETE',
      url: `/apps/installed/${active?.id}`,
      headers: auth(operator.accessToken),
    });
    expect(uninstall.statusCode).toBe(204);

    // token is revoked by uninstall
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: auth(tokens.accessToken),
    });
    expect(me.statusCode).toBe(401);
  });

  it('cross-tenant isolation: another tenant sees none of the first tenant installs', async () => {
    const other = await signup(ctx, makeSignupBody('mkt-op2', ctx));
    tenantIds.push(other.tenant.id);
    const listed = await app.inject({
      method: 'GET',
      url: '/apps/installed',
      headers: auth(other.accessToken),
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as unknown[]).length).toBe(0);
  });

  it('the directory lists the approved app publicly (no auth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/marketplace/apps?category=integration' });
    expect(res.statusCode).toBe(200);
    const page = res.json() as { apps: Array<{ slug: string }>; total: number };
    expect(page.total).toBeGreaterThanOrEqual(1);
  });
});
