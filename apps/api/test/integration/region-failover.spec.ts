/**
 * Region failover — integration coverage on the Fastify write-guard hook.
 *
 * Hermetic: builds a bare Fastify instance, registers the real
 * registerRegionGuards plugin with a simulated region config, and injects
 * requests. No DB/Redis — this exercises the HTTP behavior of the guard end to
 * end (status, headers, body) without booting the full Nest app.
 *
 * The spec'd target was POST /v1/jobs; the public-api (/v1/*) module is not on
 * master yet (separate PR), so we register a stand-in POST /v1/jobs route. The
 * guard is path/method-based, so the behavior is identical to the real route.
 */
import { ERROR_CODES } from '@ustowdispatch/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRegionGuards } from '../../src/common/region/region.middleware.js';

const PEER = 'https://api-east.example.com';

function makeRegion(role: 'primary' | 'secondary') {
  return {
    id: role === 'primary' ? 'us-east' : 'us-west',
    role,
    isPrimary: role === 'primary',
    peerOrigin: PEER,
    peerHealthcheckUrl: `${PEER}/ready`,
    replicationLagAlertSeconds: 60,
  };
}

async function buildApp(
  role: 'primary' | 'secondary',
  markWrite = vi.fn(),
): Promise<{
  app: FastifyInstance;
  markWrite: ReturnType<typeof vi.fn>;
}> {
  const app = Fastify();
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger;
  registerRegionGuards(app, {
    config: { region: makeRegion(role) } as never,
    regionContext: { markWrite } as never,
    logger,
  });
  app.post('/v1/jobs', async (_req, reply) => reply.code(201).send({ ok: true }));
  app.get('/v1/jobs', async () => ({ items: [] }));
  app.get('/ready', async () => ({ status: 'ok' }));
  await app.ready();
  return { app, markWrite };
}

describe('integration — region write guard', () => {
  let toClose: FastifyInstance | null = null;
  afterEach(async () => {
    if (toClose) await toClose.close();
    toClose = null;
  });

  it('secondary: POST /v1/jobs → 503 with Retry-After + Location → primary', async () => {
    const { app } = await buildApp('secondary');
    toClose = app;
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', payload: {} });

    expect(res.statusCode).toBe(503);
    expect(res.headers.location).toBe(`${PEER}/v1/jobs`);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.headers['x-region-id']).toBe('us-west');
    expect(res.headers['x-region-role']).toBe('secondary');
    const body = res.json();
    expect(body.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(body.primary).toBe(`${PEER}/v1/jobs`);
  });

  it('secondary: GET /v1/jobs is allowed (reads served from replica)', async () => {
    const { app } = await buildApp('secondary');
    toClose = app;
    const res = await app.inject({ method: 'GET', url: '/v1/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-region-role']).toBe('secondary');
  });

  it('secondary: POST to an exempt path (/ready) is NOT blocked', async () => {
    const { app } = await buildApp('secondary');
    toClose = app;
    // No POST /ready route exists → 404 proves the guard let it through
    // (a blocked request would be 503, never reaching routing).
    const res = await app.inject({ method: 'POST', url: '/ready' });
    expect(res.statusCode).toBe(404);
  });

  it('primary: POST /v1/jobs succeeds and stamps the last-write marker', async () => {
    const { app, markWrite } = await buildApp('primary');
    toClose = app;
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-region-role']).toBe('primary');
    expect(markWrite).toHaveBeenCalledTimes(1);
  });

  it('primary: a failed write (4xx) does NOT stamp the last-write marker', async () => {
    const { app, markWrite } = await buildApp('primary');
    toClose = app;
    // PATCH has no route → 404; onResponse must not count it as a write.
    const res = await app.inject({ method: 'PATCH', url: '/v1/jobs', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(markWrite).not.toHaveBeenCalled();
  });
});
