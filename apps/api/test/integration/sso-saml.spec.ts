/**
 * SAML 2.0 SP-initiated flow (Session 38), end-to-end through the booted app:
 *   1. GET /sso/:slug/saml/login -> 302 to IdP + signed state cookie.
 *   2. POST /sso/:slug/saml/acs (signed assertion + RelayState + cookie)
 *      -> 302 to web with tokens in the fragment, a provisioned user, and a
 *         success audit row.
 *
 * Self-skips without a database. The IdP is "mocked" by signing the assertion
 * with the connection's pinned test cert (see test/sso-saml-fixtures).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SAML_CERT, buildSignedSamlResponse } from '../sso-saml-fixtures.js';
import { ADMIN_URL, REDIS_URL, bootApp } from './helpers.js';

const skip = !ADMIN_URL || !REDIS_URL;
const describeIfDb = skip ? describe.skip : describe;

const API = 'http://localhost:3001';
const IDP_ISSUER = 'https://idp.saml-it.test/entity';
const IDP_SSO_URL = 'https://idp.saml-it.test/sso';

describeIfDb('SAML 2.0 — SP-initiated flow', () => {
  let app: NestFastifyApplication;
  let admin: Pool;
  const tenantId = uuidv7();
  const slug = `saml-it-${Date.now()}`;
  const spEntityId = `${API}/sso/${slug}/saml`;
  const acsUrl = `${API}/sso/${slug}/saml/acs`;
  const email = 'pat.morgan@saml-it.test';

  beforeAll(async () => {
    process.env.ENTERPRISE_SSO_ENABLED = 'true';
    process.env.ENTERPRISE_SSO_TENANTS = tenantId;
    process.env.API_PUBLIC_URL = API;
    app = await bootApp();
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')", [
        tenantId,
        slug,
        'SAML IT',
      ]);
      await c.query(
        `INSERT INTO sso_connections
           (id, tenant_id, provider, display_name, issuer, x509_cert, sso_url, audience, enabled)
         VALUES ($1, $2, 'saml', 'IT SAML', $3, $4, $5, $6, true)`,
        [uuidv7(), tenantId, IDP_ISSUER, TEST_SAML_CERT, IDP_SSO_URL, spEntityId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM sso_login_audit WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM sso_connections WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        } finally {
          await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
      await admin.end();
    }
    if (app) await app.close();
    // (No env cleanup needed — vitest runs each spec file in its own fork.)
  });

  it('login redirects to the IdP and sets a state cookie', async () => {
    const res = await app.inject({ method: 'GET', url: `/sso/${slug}/saml/login` });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith(IDP_SSO_URL)).toBe(true);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
    expect(cookieStr).toContain('sso_state=');
  });

  it('full round-trip: ACS validates the assertion, provisions a user, mints tokens', async () => {
    // 1. login -> capture RelayState + state cookie.
    const login = await app.inject({ method: 'GET', url: `/sso/${slug}/saml/login` });
    const loc = new URL(login.headers.location as string);
    const relayState = loc.searchParams.get('RelayState') ?? '';
    expect(relayState.length).toBeGreaterThan(0);
    const setCookie = login.headers['set-cookie'];
    const cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    const stateCookie = cookieArr
      .map((s) => (s ?? '').split(';')[0] ?? '')
      .find((s) => s.startsWith('sso_state='));
    expect(stateCookie).toBeTruthy();

    // 2. signed assertion for this SP + audience.
    const samlResponse = buildSignedSamlResponse({
      acsUrl,
      audience: spEntityId,
      issuer: IDP_ISSUER,
      email,
      firstName: 'Pat',
      lastName: 'Morgan',
    });

    const body = new URLSearchParams({
      SAMLResponse: samlResponse,
      RelayState: relayState,
    }).toString();
    const acs = await app.inject({
      method: 'POST',
      url: `/sso/${slug}/saml/acs`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: stateCookie as string,
      },
      payload: body,
    });

    expect(acs.statusCode).toBe(302);
    const redirect = acs.headers.location as string;
    expect(redirect).toContain('/login/sso/complete#');
    expect(redirect).toContain('access_token=');

    // 3. user provisioned + success audit row.
    const c = await admin.connect();
    try {
      const u = await c.query<{ role: string }>(
        'SELECT role FROM users WHERE tenant_id = $1 AND email = $2',
        [tenantId, email],
      );
      expect(u.rows).toHaveLength(1);
      const a = await c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM sso_login_audit WHERE tenant_id = $1 AND outcome = 'success'",
        [tenantId],
      );
      expect(Number(a.rows[0]?.n)).toBeGreaterThanOrEqual(1);
    } finally {
      c.release();
    }
  });

  it('rejects ACS with a mismatched RelayState (CSRF guard)', async () => {
    const login = await app.inject({ method: 'GET', url: `/sso/${slug}/saml/login` });
    const setCookie = login.headers['set-cookie'];
    const cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    const stateCookie = cookieArr
      .map((s) => (s ?? '').split(';')[0] ?? '')
      .find((s) => s.startsWith('sso_state=')) as string;

    const samlResponse = buildSignedSamlResponse({
      acsUrl,
      audience: spEntityId,
      issuer: IDP_ISSUER,
      email,
    });
    const body = new URLSearchParams({
      SAMLResponse: samlResponse,
      RelayState: 'forged-relay-state',
    }).toString();
    const acs = await app.inject({
      method: 'POST',
      url: `/sso/${slug}/saml/acs`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: stateCookie },
      payload: body,
    });
    // Failure path redirects to the web login with an error (no tokens).
    expect(acs.statusCode).toBe(302);
    expect(acs.headers.location as string).toContain('error=sso_failed');
  });
});
