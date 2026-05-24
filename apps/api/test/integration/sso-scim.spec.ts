import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
/**
 * SCIM 2.0 CRUD lifecycle (Session 38), end-to-end through the booted app.
 *
 * The env gate keys on tenant_id, which is generated at signup — so we
 * pre-generate the tenant id, put it on ENTERPRISE_SSO_TENANTS *before*
 * bootApp (ConfigService reads env at construction), then seed the tenant +
 * SCIM token via the admin pool. Self-skips without a database.
 */
import { hashToken } from '../../src/modules/auth/auth-tokens.util.js';
import { ADMIN_URL, REDIS_URL, bootApp } from './helpers.js';

const skip = !ADMIN_URL || !REDIS_URL;
const describeIfDb = skip ? describe.skip : describe;

const SCIM_JSON = 'application/scim+json';

describeIfDb('SCIM 2.0 — CRUD lifecycle', () => {
  let app: NestFastifyApplication;
  let admin: Pool;
  const tenantId = uuidv7();
  const slug = `scim-it-${Date.now()}`;
  const plainToken = `scim_test_${uuidv7()}`;
  const bearer = { authorization: `Bearer ${plainToken}`, 'content-type': SCIM_JSON };

  beforeAll(async () => {
    process.env.ENTERPRISE_SSO_ENABLED = 'true';
    process.env.ENTERPRISE_SSO_TENANTS = tenantId;
    app = await bootApp();
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')", [
        tenantId,
        slug,
        'SCIM IT',
      ]);
      await c.query(
        `INSERT INTO scim_tokens (id, tenant_id, name, token_hash, token_prefix)
         VALUES ($1, $2, 'okta', $3, 'scim_test…')`,
        [uuidv7(), tenantId, hashToken(plainToken)],
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
        for (const t of ['scim_group_members', 'scim_groups', 'scim_tokens', 'sso_login_audit']) {
          await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
        }
        await c.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM sso_connections WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
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
  });

  it('rejects a request with no / wrong bearer token (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/scim/v2/Users' });
    expect(res.statusCode).toBe(401);
    const bad = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users',
      headers: { authorization: 'Bearer nope' },
    });
    expect(bad.statusCode).toBe(401);
  });

  let createdUserId = '';

  it('POST /Users creates a user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: bearer,
      payload: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        externalId: 'ext-okta-1',
        userName: 'casey@scim-it.test',
        name: { givenName: 'Casey', familyName: 'Jones' },
        emails: [{ value: 'casey@scim-it.test', primary: true }],
        active: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.userName).toBe('casey@scim-it.test');
    expect(body.active).toBe(true);
    createdUserId = body.id;
    expect(createdUserId).toBeTruthy();
  });

  it('re-POST of the same externalId/userName is idempotent (same id)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: bearer,
      payload: {
        externalId: 'ext-okta-1',
        userName: 'casey@scim-it.test',
        name: { givenName: 'Casey', familyName: 'Jones' },
      },
    });
    expect(res.json().id).toBe(createdUserId);
  });

  it('GET /Users/:id returns the user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scim/v2/Users/${createdUserId}`,
      headers: bearer,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(createdUserId);
  });

  it('GET /Users?filter=userName eq returns a ListResponse', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scim/v2/Users?filter=${encodeURIComponent('userName eq "casey@scim-it.test"')}`,
      headers: bearer,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(body.Resources.length).toBe(1);
  });

  it('PATCH active=false de-provisions (soft-delete) and revokes sessions', async () => {
    // Seed a live session for the user, then deactivate.
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO sessions (id, tenant_id, user_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '30 days')`,
        [uuidv7(), tenantId, createdUserId, `rt-${uuidv7()}`],
      );
    } finally {
      c.release();
    }

    const res = await app.inject({
      method: 'PATCH',
      url: `/scim/v2/Users/${createdUserId}`,
      headers: bearer,
      payload: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);

    const c2 = await admin.connect();
    try {
      const u = await c2.query<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM users WHERE id = $1',
        [createdUserId],
      );
      expect(u.rows[0]?.deleted_at).not.toBeNull();
      const s = await c2.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL',
        [createdUserId],
      );
      expect(Number(s.rows[0]?.n)).toBeGreaterThanOrEqual(1);
    } finally {
      c2.release();
    }
  });

  it('Groups: POST creates and GET returns the group', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/scim/v2/Groups',
      headers: bearer,
      payload: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        externalId: 'grp-1',
        displayName: 'Dispatchers',
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;
    const get = await app.inject({
      method: 'GET',
      url: `/scim/v2/Groups/${id}`,
      headers: bearer,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().displayName).toBe('Dispatchers');
  });
});
