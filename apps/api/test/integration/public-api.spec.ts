/**
 * Integration tests for the Public REST API + Webhooks (Session 29). Drives
 * the real HTTP surface against the docker stack (Postgres + Redis):
 *   - mint an API key → call /v1/jobs with the Bearer key → 200
 *   - wrong scope → 403 insufficient_scope
 *   - revoked key → 401 api_key_invalid
 *   - write requires jobs:write
 *   - Idempotency-Key replays the first response
 *   - publishing an event enqueues a delivery; the worker schedules a retry
 *     when the sink is unreachable
 *
 * DB-gated via skipIfNoDb. Cleans up its own public-api rows in afterAll
 * BEFORE tearDown() (tenant_id ON DELETE RESTRICT).
 */
import type { CreateApiKeyResult, CreateWebhookEndpointResult } from '@ustowdispatch/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebhookDeliveryWorker } from '../../src/modules/public-api/webhooks/webhook-delivery.worker.js';
import { WebhookPublisher } from '../../src/modules/public-api/webhooks/webhook-publisher.service.js';
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

const describeIfDb = skipIfNoDb ? describe.skip : describe;

const INTAKE = {
  customer: { name: 'Pat Public', phone: '+15555550123', email: 'pat@public.test' },
  vehicle: { vin: '1HGCM82633A004352', vehicleClass: 'light_duty' as const },
  serviceType: 'lockout' as const,
  pickup: { address: '1 Test Plaza' },
};

describeIfDb('integration — public API + webhooks', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let tenantId: string;
  let sessionToken: string;
  const tenantIds: string[] = [];

  // session-authed management call
  function mgmt(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    return ctx.app.inject({
      method,
      url,
      headers: { ...auth(sessionToken), 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  // API-key-authed /v1 call
  function v1(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    apiKey: string,
    payload?: object,
    extraHeaders: Record<string, string> = {},
  ) {
    return ctx.app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  async function createKey(scopes: string[]): Promise<CreateApiKeyResult> {
    const res = await mgmt('POST', '/public-api/keys', { name: `k-${scopes.join('-')}`, scopes });
    expect(res.statusCode).toBe(201);
    return res.json() as CreateApiKeyResult;
  }

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('papi', ctx));
    tenantId = owner.tenant.id;
    sessionToken = owner.accessToken;
    tenantIds.push(tenantId);
    await seedDefaultRateSheet(ctx, tenantId);
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const table of [
          'webhook_deliveries',
          'public_api_idempotency_keys',
          'webhook_endpoints',
          'api_keys',
        ]) {
          await c.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('mints a key and lists jobs with it (cursor envelope)', async () => {
    const { plaintextKey } = await createKey(['jobs:read', 'jobs:write']);
    const res = await v1('GET', '/v1/jobs', plaintextKey);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; nextCursor: string | null; hasMore: boolean };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('hasMore');
    expect(body).toHaveProperty('nextCursor');
  });

  it('rejects a request whose key lacks the route scope (403)', async () => {
    const { plaintextKey } = await createKey(['jobs:read']);
    const res = await v1('GET', '/v1/trucks', plaintextKey);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('insufficient_scope');
  });

  it('creates a job via the key and fires JOB_CREATED (write scope)', async () => {
    const { plaintextKey } = await createKey(['jobs:read', 'jobs:write']);
    const res = await v1('POST', '/v1/jobs', plaintextKey, INTAKE);
    expect(res.statusCode).toBe(201);
    const job = res.json() as { id: string; jobNumber: string; status: string };
    expect(job.status).toBe('new');
    expect(job.jobNumber).toBeTruthy();
  });

  it('rejects a write from a read-only key (403)', async () => {
    const { plaintextKey } = await createKey(['jobs:read']);
    const res = await v1('POST', '/v1/jobs', plaintextKey, INTAKE);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('insufficient_scope');
  });

  it('replays the response for a repeated Idempotency-Key', async () => {
    const { plaintextKey } = await createKey(['jobs:read', 'jobs:write']);
    const headers = { 'idempotency-key': `idem-${Date.now()}` };
    const first = await v1('POST', '/v1/jobs', plaintextKey, INTAKE, headers);
    const second = await v1('POST', '/v1/jobs', plaintextKey, INTAKE, headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect((first.json() as { id: string }).id).toBe((second.json() as { id: string }).id);
  });

  it('401s a revoked key', async () => {
    const created = await createKey(['jobs:read']);
    const revoke = await mgmt('POST', `/public-api/keys/${created.apiKey.id}/revoke`);
    expect(revoke.statusCode).toBe(201);
    const res = await v1('GET', '/v1/jobs', created.plaintextKey);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('api_key_invalid');
  });

  it('401s a malformed / missing key', async () => {
    expect((await v1('GET', '/v1/jobs', 'not-a-key')).statusCode).toBe(401);
    const noKey = await ctx.app.inject({ method: 'GET', url: '/v1/jobs' });
    expect(noKey.statusCode).toBe(401);
  });

  it('publishes a delivery on an event and schedules a retry when the sink is unreachable', async () => {
    const create = await mgmt('POST', '/public-api/webhooks', {
      url: 'https://example.invalid/hook',
      events: ['job.created'],
    });
    expect(create.statusCode).toBe(201);
    const { endpoint, signingSecret } = create.json() as CreateWebhookEndpointResult;
    expect(signingSecret).toMatch(/^whsec_/);

    const publisher = ctx.app.get(WebhookPublisher);
    const enqueued = await publisher.publish(tenantId, {
      name: 'job.created',
      // biome-ignore lint/suspicious/noExplicitAny: synthetic event payload for the test
      payload: { job: { id: '018f3a1c-0000-7000-8000-0000000000aa' } } as any,
    });
    expect(enqueued).toBe(1);

    // One pending delivery row for our endpoint.
    const pending = await ctx.admin.query<{ id: string; status: string }>(
      'SELECT id, status FROM webhook_deliveries WHERE endpoint_id = $1::uuid',
      [endpoint.id],
    );
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]?.status).toBe('pending');

    // Sweep: the sink is unreachable, so the attempt fails and a retry is set.
    const worker = ctx.app.get(WebhookDeliveryWorker);
    await worker.sweep(new Date());

    const after = await ctx.admin.query<{
      status: string;
      attempt: number;
      next_retry_at: Date | null;
      last_error: string | null;
    }>(
      'SELECT status, attempt, next_retry_at, last_error FROM webhook_deliveries WHERE endpoint_id = $1::uuid',
      [endpoint.id],
    );
    expect(after.rows[0]?.attempt).toBe(1);
    expect(after.rows[0]?.status).toBe('pending'); // not yet exhausted
    expect(after.rows[0]?.next_retry_at).not.toBeNull();
    expect(after.rows[0]?.last_error).toBeTruthy();
  });
});
