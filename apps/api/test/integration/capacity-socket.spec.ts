/**
 * CADS Socket.IO tenant-isolation contract test (gate 4).
 *
 * Mirrors dispatch-socket.spec.ts: two clients on different tenants; a
 * capacity recompute for tenant A must emit capacity.status_changed to
 * A's room only. The recompute is driven through the real
 * CapacityEventsListener.run() path, so the whole chain — compute →
 * DispatchEventsService → gateway room fan-out — is under test.
 */
import type { Server as HttpServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DISPATCH_EVENTS } from '@ustowdispatch/shared';
import { Pool } from 'pg';
import { type Socket, io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter.js';
import { registerRequestContext } from '../../src/common/middleware/request-context.middleware.js';
import { ZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../../src/config/config.service.js';
import { CapacityEventsListener } from '../../src/modules/capacity/capacity-events.listener.js';
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

const SUFFIX = `capsock-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('CADS Socket.IO tenant isolation', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let httpServer: HttpServer;
  let port: number;
  let tenantA: AuthedResp;
  let tenantB: AuthedResp;

  beforeAll(async () => {
    ensureTestEnv();
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    const config = app.get(ConfigService);
    registerRequestContext(app.getHttpAdapter().getInstance());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter(config));
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

  it("capacity.status_changed reaches only the owning tenant's room", async () => {
    const listener = app.get(CapacityEventsListener);
    const sockA = await connect(tenantA.accessToken);
    const sockB = await connect(tenantB.accessToken);

    const seenByA: unknown[] = [];
    const seenByB: unknown[] = [];
    sockA.on(DISPATCH_EVENTS.CAPACITY_STATUS_CHANGED, (p: unknown) => seenByA.push(p));
    sockB.on(DISPATCH_EVENTS.CAPACITY_STATUS_CHANGED, (p: unknown) => seenByB.push(p));

    await new Promise((r) => setTimeout(r, 100));

    // Drive a REAL recompute for tenant A only (the widget's live path).
    await listener.run(tenantA.tenant.id, 'socket-isolation-test');
    await new Promise((r) => setTimeout(r, 300));

    expect(seenByA.length).toBeGreaterThanOrEqual(1);
    expect(seenByB).toHaveLength(0);
    const payload = seenByA[0] as { blended?: { dutyClass?: string }; computedAt?: string };
    expect(payload.blended?.dutyClass).toBe('all');
    expect(payload.computedAt).toBeTruthy();

    // Inverse: a recompute for B reaches B, not A.
    const aCount = seenByA.length;
    await listener.run(tenantB.tenant.id, 'socket-isolation-test');
    await new Promise((r) => setTimeout(r, 300));
    expect(seenByB.length).toBeGreaterThanOrEqual(1);
    expect(seenByA.length).toBe(aCount);

    sockA.disconnect();
    sockB.disconnect();
  });
});
