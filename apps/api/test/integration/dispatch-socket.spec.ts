/**
 * Socket.IO tenant-isolation contract test.
 *
 * Two clients connect with tokens belonging to different tenants. The API
 * fires a job.created event for tenant A. Tenant B's client must not
 * receive it within a generous timeout. Then we fire one for tenant B and
 * assert the inverse.
 *
 * This is the runtime proof that the gateway's tenant-room model is
 * working — alongside the in-process DispatchEventsService unit test we
 * cover the contract end-to-end.
 */
import type { Server as HttpServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DISPATCH_EVENTS } from '@towcommand/shared';
import { Pool } from 'pg';
import { type Socket, io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter.js';
import { registerRequestContext } from '../../src/common/middleware/request-context.middleware.js';
import { ZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../../src/config/config.service.js';
import { DispatchEventsService } from '../../src/modules/dispatch/dispatch-events.service.js';
import { DispatchGateway } from '../../src/modules/dispatch/dispatch.gateway.js';
import {
  type AuthedResp,
  type TestContext,
  ensureTestEnv,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `sock-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('Dispatch Socket.IO tenant isolation', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let httpServer: HttpServer;
  let port: number;
  let tenantA: AuthedResp;
  let tenantB: AuthedResp;

  beforeAll(async () => {
    ensureTestEnv();
    // Custom boot — we need the HTTP server actually listening on a port
    // so the Socket.IO client can connect. Mirrors helpers.bootApp() but
    // with a real listen + gateway.attach.
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    const config = app.get(ConfigService);
    registerRequestContext(app.getHttpAdapter().getInstance());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter(config.logger));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1');
    httpServer = app.getHttpServer();
    const addr = httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;

    const gateway = app.get(DispatchGateway);
    await gateway.attach(httpServer);

    ctx = {
      app,
      admin: new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 }),
      createdTenantSlugs: [],
      createdEmails: [],
    };
    tenantA = await signup(ctx, makeSignupBody(`${SUFFIX}-a`, ctx));
    tenantB = await signup(ctx, makeSignupBody(`${SUFFIX}-b`, ctx));
  });

  afterAll(async () => {
    await tearDown(ctx);
  });

  function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        path: '/socket.io',
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => reject(err));
    });
  }

  it('connection is rejected without a token', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = ioClient(`http://127.0.0.1:${port}`, {
          path: '/socket.io',
          transports: ['websocket'],
          reconnection: false,
        });
        socket.once('connect', () => {
          socket.disconnect();
          reject(new Error('connected unexpectedly'));
        });
        socket.once('connect_error', () => {
          socket.disconnect();
          resolve();
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('tenant A client does NOT receive tenant B job.created events', async () => {
    const events = app.get(DispatchEventsService);
    const sockA = await connect(tenantA.accessToken);
    const sockB = await connect(tenantB.accessToken);

    const seenByA: unknown[] = [];
    const seenByB: unknown[] = [];
    sockA.on(DISPATCH_EVENTS.JOB_CREATED, (p: unknown) => seenByA.push(p));
    sockB.on(DISPATCH_EVENTS.JOB_CREATED, (p: unknown) => seenByB.push(p));

    // Give the rooms a moment to settle (Socket.IO handles join sync).
    await new Promise((r) => setTimeout(r, 100));

    // Fire an event for tenant A only.
    events.emit(tenantA.tenant.id, DISPATCH_EVENTS.JOB_CREATED, {
      job: { id: 'fake-a', tenantId: tenantA.tenant.id },
    } as unknown as Parameters<typeof events.emit>[2]);

    // Fire one for tenant B only.
    events.emit(tenantB.tenant.id, DISPATCH_EVENTS.JOB_CREATED, {
      job: { id: 'fake-b', tenantId: tenantB.tenant.id },
    } as unknown as Parameters<typeof events.emit>[2]);

    await new Promise((r) => setTimeout(r, 250));

    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(1);
    expect(JSON.stringify(seenByA[0])).toContain('fake-a');
    expect(JSON.stringify(seenByB[0])).toContain('fake-b');

    sockA.disconnect();
    sockB.disconnect();
  });
});
