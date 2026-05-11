/**
 * QuickBooks Online accounting integration spec — Session 12.
 *
 * The ACCOUNTING_PROVIDER token is overridden with a fresh QboStubProvider
 * instance so each test can inspect what the service asked the provider to
 * do (customers / invoices / payments / refunds synced) without touching a
 * real Intuit sandbox.
 *
 * Coverage:
 *   - OAuth start + callback against the stub
 *   - Account-mapping CRUD
 *   - Chart-of-accounts pull
 *   - Sync engine: enqueue, processBatch, retry, dead-letter
 *   - Idempotency: second enqueue while pending is a no-op
 *   - Tenant isolation: tenant B cannot see tenant A's sync jobs
 *   - Webhook signature verification (good + tampered)
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter.js';
import { registerRawBodyJsonParser } from '../../src/common/middleware/raw-body.middleware.js';
import { registerRequestContext } from '../../src/common/middleware/request-context.middleware.js';
import { ZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../../src/config/config.service.js';
import { AccountingService } from '../../src/modules/accounting/accounting.service.js';
import { ACCOUNTING_PROVIDER } from '../../src/modules/accounting/accounting.tokens.js';
import { QboStubProvider } from '../../src/modules/accounting/qbo-stub.provider.js';
import { SyncEngineService } from '../../src/modules/accounting/sync-engine.service.js';
import {
  type AuthedResp,
  type TestContext,
  auth,
  ensureTestEnv,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const SUFFIX = `acc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface AccCtx extends TestContext {
  stub: QboStubProvider;
  engine: SyncEngineService;
  service: AccountingService;
}

async function bootAppWithStub(stub: QboStubProvider): Promise<NestFastifyApplication> {
  ensureTestEnv();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ACCOUNTING_PROVIDER)
    .useValue(stub)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  const config = app.get(ConfigService);
  registerRequestContext(app.getHttpAdapter().getInstance());
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(config.logger));
  await app.init();
  registerRawBodyJsonParser(app.getHttpAdapter().getInstance());
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

async function makeAccountingContext(stub: QboStubProvider): Promise<AccCtx> {
  const app = await bootAppWithStub(stub);
  const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  const admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
  const engine = app.get(SyncEngineService);
  const service = app.get(AccountingService);
  return {
    app,
    admin,
    createdTenantSlugs: [],
    createdEmails: [],
    stub,
    engine,
    service,
  };
}

async function manuallyConnect(ctx: AccCtx, session: AuthedResp): Promise<{ realmId: string }> {
  // Drive the connect flow against the stub. The flow returns a state token
  // we then pass back through the callback to land a `connected` row.
  const startRes = await ctx.app.inject({
    method: 'POST',
    url: '/accounting/connect/start',
    headers: auth(session.accessToken),
  });
  if (startRes.statusCode !== 200) {
    throw new Error(`connect/start failed: ${startRes.statusCode} ${startRes.body}`);
  }
  const start = startRes.json() as { authorizationUrl: string; state: string };
  const realmId = `realm_${Math.random().toString(36).slice(2, 10)}`;
  const cb = await ctx.app.inject({
    method: 'GET',
    url: `/accounting/connect/callback?code=auth-code-${realmId}&state=${start.state}&realmId=${realmId}`,
    headers: auth(session.accessToken),
  });
  if (cb.statusCode !== 200) {
    throw new Error(`callback failed: ${cb.statusCode} ${cb.body}`);
  }
  return { realmId };
}

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1555555${phoneSeq.toString().padStart(4, '0')}`;
}

async function createCustomer(
  ctx: AccCtx,
  session: AuthedResp,
  name: string,
  email: string,
): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/customers',
    headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
    payload: {
      customerType: 'individual',
      name,
      email,
      phone: nextPhone(),
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`customer create failed: ${res.statusCode} ${res.body}`);
  }
  return (res.json() as { id: string }).id;
}

async function bumpAttemptToNow(admin: Pool, jobId: string): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query('UPDATE sync_jobs SET next_attempt_at = now() WHERE id = $1::uuid', [jobId]);
  } finally {
    c.release();
  }
}

describeIfDb('Accounting (QuickBooks Online) integration', () => {
  let ctx: AccCtx;
  let app: NestFastifyApplication;
  let session: AuthedResp;
  let attacker: AuthedResp;

  beforeAll(async () => {
    const stub = new QboStubProvider();
    ctx = await makeAccountingContext(stub);
    app = ctx.app;
    session = await signup(ctx, makeSignupBody(SUFFIX, ctx));
    attacker = await signup(ctx, makeSignupBody(`${SUFFIX}-att`, ctx));
  });

  afterAll(async () => {
    if (ctx.admin) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        const ids = [session.tenant.id, attacker.tenant.id];
        await c.query('DELETE FROM sync_jobs WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM account_mappings WHERE tenant_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM accounting_connections WHERE tenant_id = ANY($1::uuid[])', [
          ids,
        ]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  // =========================================================
  // Status / config
  // =========================================================

  it('GET /accounting/connect/status returns null connection on fresh tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/accounting/connect/status',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { provider: string; connection: unknown };
    expect(body.provider).toBe('quickbooks-online-stub');
    expect(body.connection).toBeNull();
  });

  // =========================================================
  // OAuth + connect lifecycle
  // =========================================================

  it('connect/start → callback persists a connected accounting_connections row', async () => {
    const { realmId } = await manuallyConnect(ctx, session);
    expect(realmId).toMatch(/^realm_/);
    const c = await ctx.admin.connect();
    try {
      const r = await c.query<{
        status: string;
        realm_id: string;
        encrypted_access_token: string;
      }>(
        `SELECT status, realm_id, encrypted_access_token FROM accounting_connections
          WHERE tenant_id = $1::uuid`,
        [session.tenant.id],
      );
      expect(r.rows[0]?.status).toBe('connected');
      expect(r.rows[0]?.realm_id).toBe(realmId);
      expect((r.rows[0]?.encrypted_access_token ?? '').length).toBeGreaterThan(20);
    } finally {
      c.release();
    }
  });

  it('connect/callback with a bad state token returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/accounting/connect/callback?code=x&state=tampered-state&realmId=r1',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(400);
  });

  // =========================================================
  // Chart of accounts + mapping
  // =========================================================

  it('GET /accounting/chart-of-accounts returns the stub chart', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/accounting/chart-of-accounts',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accounts: Array<{ name: string }> };
    expect(body.accounts.length).toBeGreaterThan(5);
    expect(body.accounts.find((a) => a.name === 'Service Revenue')).toBeTruthy();
  });

  it('PUT /accounting/account-mapping upserts, GET /accounting/account-mapping returns it', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/accounting/account-mapping',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: {
        internalCategory: 'service_revenue',
        externalAccountId: 'acct-100',
        externalAccountName: 'Service Revenue',
        externalAccountType: 'Income',
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({
      method: 'GET',
      url: '/accounting/account-mapping',
      headers: auth(session.accessToken),
    });
    const body = get.json() as {
      mappings: Array<{ internalCategory: string; externalAccountId: string }>;
    };
    expect(
      body.mappings.find((m) => m.internalCategory === 'service_revenue')?.externalAccountId,
    ).toBe('acct-100');

    // Second PUT updates rather than duplicating (unique on tenant+provider+category).
    const put2 = await app.inject({
      method: 'PUT',
      url: '/accounting/account-mapping',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { internalCategory: 'service_revenue', externalAccountId: 'acct-999' },
    });
    expect(put2.statusCode).toBe(200);
    const get2 = await app.inject({
      method: 'GET',
      url: '/accounting/account-mapping',
      headers: auth(session.accessToken),
    });
    const body2 = get2.json() as {
      mappings: Array<{ internalCategory: string; externalAccountId: string }>;
    };
    expect(
      body2.mappings.find((m) => m.internalCategory === 'service_revenue')?.externalAccountId,
    ).toBe('acct-999');
  });

  // =========================================================
  // Sync engine
  // =========================================================

  it('enqueue + processBatchForTenant pushes a customer through the stub provider', async () => {
    const customerId = await createCustomer(ctx, session, 'Sync Customer One', 'sync1@spec.test');
    const jobId = await ctx.service.enqueueCustomerSync(session.tenant.id, customerId);
    expect(jobId).toBeTruthy();
    const before = ctx.stub.customers.size;
    const result = await ctx.engine.processBatchForTenant(session.tenant.id, 10);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
    expect(ctx.stub.customers.size).toBe(before + 1);
  });

  it('second enqueue while pending is an idempotent no-op (returns null)', async () => {
    const customerId = await createCustomer(ctx, session, 'Idem Customer', 'idem@spec.test');
    const first = await ctx.service.enqueueCustomerSync(session.tenant.id, customerId);
    const second = await ctx.service.enqueueCustomerSync(session.tenant.id, customerId);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it('a failing handler bumps retry_count and rolls back to pending; 5 failures → dead_letter', async () => {
    const customerId = await createCustomer(ctx, session, 'Retry Customer', 'retry@spec.test');
    // Force every subsequent syncCustomer call to throw.
    const originalSync = ctx.stub.syncCustomer.bind(ctx.stub);
    const failingStub = (async () => {
      throw new Error('forced failure');
    }) as typeof ctx.stub.syncCustomer;
    (ctx.stub as { syncCustomer: typeof ctx.stub.syncCustomer }).syncCustomer = failingStub;
    try {
      const jobId = (await ctx.service.enqueueCustomerSync(
        session.tenant.id,
        customerId,
      )) as string;
      // Process 5 times — each will fail and bump retry_count.
      for (let i = 0; i < 5; i += 1) {
        await bumpAttemptToNow(ctx.admin, jobId);
        await ctx.engine.processBatchForTenant(session.tenant.id, 10);
      }
      const c = await ctx.admin.connect();
      try {
        const r = await c.query<{ status: string; retry_count: number }>(
          'SELECT status, retry_count FROM sync_jobs WHERE id = $1::uuid',
          [jobId],
        );
        expect(r.rows[0]?.status).toBe('dead_letter');
        expect(r.rows[0]?.retry_count).toBe(5);
      } finally {
        c.release();
      }

      // retrySync moves the dead-letter row back to pending.
      const ctxObj = {
        tenantId: session.tenant.id,
        userId: session.user.id,
        requestId: 'req-test',
        ipAddress: null,
        userAgent: null,
        role: 'owner',
      };
      await ctx.service.retrySync(ctxObj, 'customer', customerId);
      const c2 = await ctx.admin.connect();
      try {
        const r = await c2.query<{ status: string }>(
          'SELECT status FROM sync_jobs WHERE id = $1::uuid',
          [jobId],
        );
        expect(r.rows[0]?.status).toBe('pending');
      } finally {
        c2.release();
      }
    } finally {
      (ctx.stub as { syncCustomer: typeof ctx.stub.syncCustomer }).syncCustomer = originalSync;
    }
  });

  it('tenant isolation: tenant B sees zero sync_jobs from tenant A', async () => {
    const a = await createCustomer(ctx, session, 'TenantA Customer', 'a@spec.test');
    await ctx.service.enqueueCustomerSync(session.tenant.id, a);

    const res = await app.inject({
      method: 'GET',
      url: '/accounting/sync-status',
      headers: auth(attacker.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totals: { pending: number; completed: number };
      recent: unknown[];
    };
    expect(body.recent.length).toBe(0);
    expect(body.totals.pending).toBe(0);
    expect(body.totals.completed).toBe(0);
  });

  // =========================================================
  // Webhook signature
  // =========================================================

  it('POST /webhooks/quickbooks rejects an invalid signature', async () => {
    const body = JSON.stringify({ eventNotifications: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/quickbooks',
      headers: { 'content-type': 'application/json', 'intuit-signature': 'invalid==' },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /webhooks/quickbooks accepts a signed payload and enqueues pull jobs', async () => {
    const config = app.get(ConfigService);
    const verifier = config.quickbooks.webhookVerifierToken;
    // Use the connected tenant's realmId
    const c = await ctx.admin.connect();
    let realmId = '';
    try {
      const r = await c.query<{ realm_id: string }>(
        'SELECT realm_id FROM accounting_connections WHERE tenant_id = $1::uuid LIMIT 1',
        [session.tenant.id],
      );
      realmId = r.rows[0]?.realm_id ?? '';
    } finally {
      c.release();
    }
    expect(realmId).not.toBe('');
    const payload = {
      eventNotifications: [
        {
          realmId,
          dataChangeEvent: {
            entities: [
              {
                name: 'Invoice',
                id: '101',
                operation: 'Update',
                lastUpdated: '2026-05-10T00:00:00Z',
              },
            ],
          },
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const sig = QboStubProvider.signPayload(raw, verifier);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/quickbooks',
      headers: { 'content-type': 'application/json', 'intuit-signature': sig },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enqueued: number };
    expect(body.enqueued).toBeGreaterThanOrEqual(1);
  });

  // =========================================================
  // Manual sync endpoint
  // =========================================================

  it('POST /accounting/sync/manual enqueues a job for a specific customer', async () => {
    const customerId = await createCustomer(
      ctx,
      session,
      'Manual Sync Customer',
      'manual@spec.test',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/accounting/sync/manual',
      headers: { ...auth(session.accessToken), 'content-type': 'application/json' },
      payload: { entityType: 'customer', entityId: customerId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enqueued: boolean };
    expect(body.enqueued).toBe(true);
  });

  // =========================================================
  // Disconnect
  // =========================================================

  it('POST /accounting/connect/disconnect marks the connection disconnected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounting/connect/disconnect',
      headers: auth(session.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { disconnected: boolean };
    expect(body.disconnected).toBe(true);
    const status = await app.inject({
      method: 'GET',
      url: '/accounting/connect/status',
      headers: auth(session.accessToken),
    });
    const sbody = status.json() as { connection: { status: string } | null };
    expect(sbody.connection?.status).toBe('disconnected');
  });
});
