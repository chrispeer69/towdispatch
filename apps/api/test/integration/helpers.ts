/**
 * Shared bootstrap for the customer / vehicle / account integration specs.
 *
 * Each spec calls bootApp() in beforeAll to spin up a NestFastifyApplication
 * pointed at the docker stack (Postgres + Redis), and tearDown() in afterAll
 * to flush the data it created. The created tenant slugs and emails are
 * captured so cleanup is precise — no broad DELETEs on shared tables.
 */
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter.js';
import { registerRequestContext } from '../../src/common/middleware/request-context.middleware.js';
import { ZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../../src/config/config.service.js';

export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
export const APP_URL = process.env.DATABASE_URL;
export const REDIS_URL = process.env.REDIS_URL;
export const skipIfNoDb = !ADMIN_URL || !APP_URL || !REDIS_URL;

export interface AuthedResp {
  status: 'authenticated';
  user: { id: string; email: string };
  tenant: { id: string; slug: string };
  accessToken: string;
  refreshToken: string;
}

export interface SignupBody {
  tenantName: string;
  tenantSlug: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
}

export function ensureTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.LOG_LEVEL ??= 'warn';
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-32-chars-long';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-at-least-32-chars-long';
  process.env.JWT_MFA_SECRET ??= 'test-mfa-secret-with-at-least-32-chars-long';
  process.env.TOTP_ENCRYPTION_KEY ??= 'test-totp-encryption-key-32+-chars-long';
}

export async function bootApp(): Promise<NestFastifyApplication> {
  ensureTestEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  const config = app.get(ConfigService);
  registerRequestContext(app.getHttpAdapter().getInstance());
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(config.logger));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface TestContext {
  app: NestFastifyApplication;
  admin: Pool;
  createdTenantSlugs: string[];
  createdEmails: string[];
}

export async function makeContext(): Promise<TestContext> {
  const app = await bootApp();
  const admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
  return { app, admin, createdTenantSlugs: [], createdEmails: [] };
}

export async function tearDown(ctx: TestContext): Promise<void> {
  if (ctx.admin) {
    const c = await ctx.admin.connect();
    try {
      await c.query('BEGIN');
      if (ctx.createdEmails.length) {
        const tenantIdsRes = await c.query<{ id: string }>(
          'SELECT id FROM tenants WHERE slug = ANY($1::text[])',
          [ctx.createdTenantSlugs],
        );
        const tenantIds = tenantIdsRes.rows.map((r) => r.id);

        if (tenantIds.length) {
          // Delete dependent data inside the captured tenants. Using
          // tenant_id keeps us from touching unrelated test data.
          await c.query('DELETE FROM customer_vehicles WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM vehicles WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM customers WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query(
            `DELETE FROM email_verification_tokens
             WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
            [ctx.createdEmails],
          );
          await c.query(
            `DELETE FROM password_reset_tokens
             WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
            [ctx.createdEmails],
          );
          await c.query(
            `DELETE FROM sessions
             WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
            [ctx.createdEmails],
          );
          await c.query('DELETE FROM users WHERE email = ANY($1::text[])', [ctx.createdEmails]);
          await c.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
          try {
            await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
          } finally {
            await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
          }
        }
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    await ctx.admin.end();
  }
  if (ctx.app) await ctx.app.close();
}

export function makeSignupBody(suffix: string, ctx: TestContext): SignupBody {
  const slug = `${suffix}-${ctx.createdTenantSlugs.length}`;
  const email = `owner-${suffix}-${ctx.createdTenantSlugs.length}@spec.test`;
  ctx.createdTenantSlugs.push(slug);
  ctx.createdEmails.push(email);
  return {
    tenantName: `Workshop ${slug}`,
    tenantSlug: slug,
    ownerName: 'Owner Tester',
    ownerEmail: email,
    password: 'CorrectHorse-Battery-9!',
  };
}

export async function signup(ctx: TestContext, body: SignupBody): Promise<AuthedResp> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/auth/signup',
    headers: { 'content-type': 'application/json' },
    payload: body as unknown as Record<string, unknown>,
  });
  if (res.statusCode !== 201) {
    throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  }
  return res.json() as AuthedResp;
}

export const auth = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
