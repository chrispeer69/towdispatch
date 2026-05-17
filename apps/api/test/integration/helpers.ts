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
import { registerRawBodyJsonParser } from '../../src/common/middleware/raw-body.middleware.js';
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
  process.env.JWT_SECRET ??= 'test-jwt-secret-with-at-least-32-chars-long';
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-32-chars-long';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-at-least-32-chars-long';
  process.env.JWT_MFA_SECRET ??= 'test-mfa-secret-with-at-least-32-chars-long';
  process.env.TOTP_ENCRYPTION_KEY ??= 'test-totp-encryption-key-32+-chars-long';
  // Tests do many signups + intakes against a single API instance; bump the
  // throttler so a busy test file does not 429 itself. The dedicated auth
  // throttle (per-email) still enforces sane limits inside AuthService.
  process.env.RATE_LIMIT_BURST_LIMIT = process.env.RATE_LIMIT_BURST_LIMIT ?? '5000';
  process.env.RATE_LIMIT_SUSTAINED_LIMIT = process.env.RATE_LIMIT_SUSTAINED_LIMIT ?? '50000';
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
  // Replace Nest's default application/json parser with one that captures
  // the raw body for Stripe webhook signature verification. Must run after
  // init() so Nest's default has been registered first.
  registerRawBodyJsonParser(app.getHttpAdapter().getInstance());
  // Mirror main.ts: register the application/zip parser used by the Towbook
  // import endpoint. Without this, Fastify rejects the body with 415 and
  // every import test silently fails as a 5xx.
  const fi = app.getHttpAdapter().getInstance();
  fi.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );
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
          // Order matters — children (FK referrers) before parents.
          // Session 12 accounting tables — wipe before tenants.
          await c.query('DELETE FROM sync_jobs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM account_mappings WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM accounting_connections WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          // Session 6.2 chat tables — children before parents.
          await c.query('DELETE FROM chat_messages WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM chat_threads WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          // Session 8 fleet leaves: dvirs / maintenance / documents /
          // driver_truck_assignments all reference drivers and/or trucks.
          await c.query('DELETE FROM dvirs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM maintenance_records WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM maintenance_schedules WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM documents WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM driver_truck_assignments WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          // Session 9 tracking leaves: tracking_messages references
          // tracking_links; tracking_links and job_ratings reference jobs.
          await c.query('DELETE FROM tracking_messages WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM job_ratings WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM tracking_links WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          // Session 10 billing leaves: payments / invoice_taxes / invoice_line_items
          // / credit_memos / invoices reference jobs/customers/accounts, and
          // invoices.tenant_id has ON DELETE RESTRICT — so they MUST be cleared
          // before the tenant DELETE below.
          // Build 5 audit tables — statement_sends + red_alert_sends. Both
          // reference accounts (statement_sends) / tenants and use
          // ON DELETE RESTRICT on tenant_id, so clear first.
          await c.query('DELETE FROM red_alert_sends WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM statement_sends WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM payments WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM invoice_taxes WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM invoice_line_items WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM credit_memos WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query(
            'DELETE FROM recurring_billing_schedules WHERE tenant_id = ANY($1::uuid[])',
            [tenantIds],
          );
          await c.query('DELETE FROM invoices WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM invoice_number_sequences WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          // Session 5 dispatch leaves: job_status_transitions and
          // driver_shifts both reference jobs/drivers/trucks.
          await c.query('DELETE FROM job_status_transitions WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM driver_shifts WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM jobs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM job_number_sequences WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM drivers WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM trucks WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query(
            'DELETE FROM tenant_default_rate_sheets WHERE tenant_id = ANY($1::uuid[])',
            [tenantIds],
          );
          await c.query('DELETE FROM customer_vehicles WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          // Session 16 import tables — import_run_events FK-cascades on
          // import_runs, but import_runs.tenant_id is ON DELETE RESTRICT,
          // so the rows must be cleared explicitly before the tenant
          // delete. Order: events (child) → runs (parent).
          await c.query('DELETE FROM import_run_events WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query('DELETE FROM import_runs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM vehicles WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM customers WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          // Build 6 account-rate-cards: account_rate_overrides cascades
          // when accounts are deleted, but service_catalog has
          // ON DELETE RESTRICT — so wipe overrides + availability before
          // service_catalog below.
          await c.query('DELETE FROM account_rate_overrides WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
          await c.query(
            'DELETE FROM account_service_availability WHERE tenant_id = ANY($1::uuid[])',
            [tenantIds],
          );
          await c.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM rate_sheets WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          // service_rates first — FK to service_catalog with ON DELETE CASCADE
          // would handle it, but listing it explicitly keeps the order
          // intentional and parallel to the rest of the cleanup.
          await c.query('DELETE FROM service_rates WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
          await c.query('DELETE FROM service_catalog WHERE tenant_id = ANY($1::uuid[])', [
            tenantIds,
          ]);
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
          // user_invites references users(invited_by) ON DELETE RESTRICT, so
          // wipe invites for the tenants before deleting the users.
          await c.query('DELETE FROM user_invites WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
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

/**
 * Seed a tenant default rate sheet directly via the admin pool. Lets job-
 * intake tests rely on real RateEngineService output (source: 'tenant_default')
 * instead of the hard-coded fallback. Idempotent: safe to call multiple
 * times for the same tenant.
 */
const DEFAULT_TEST_RATE_SHEET = {
  version: 1 as const,
  currency: 'USD' as const,
  freeMilesIncluded: 0,
  services: [
    {
      serviceType: 'tow' as const,
      baseCents: 9500,
      perMileCentsByClass: {
        light_duty: 450,
        medium_duty: 700,
        heavy_duty: 1100,
        motorcycle: 450,
        commercial: 900,
        rv: 800,
        unknown: 450,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'jump_start' as const,
      baseCents: 7500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'lockout' as const,
      baseCents: 6500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'tire_change' as const,
      baseCents: 8500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    { serviceType: 'fuel' as const, baseCents: 7500, perMileCentsByClass: {}, flatFeesByClass: {} },
    {
      serviceType: 'winch' as const,
      baseCents: 15000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'recovery' as const,
      baseCents: 25000,
      perMileCentsByClass: {
        light_duty: 600,
        medium_duty: 900,
        heavy_duty: 1500,
        motorcycle: 600,
        commercial: 1200,
        rv: 1200,
        unknown: 600,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'impound' as const,
      baseCents: 12500,
      perMileCentsByClass: {
        light_duty: 450,
        medium_duty: 700,
        heavy_duty: 1100,
        motorcycle: 450,
        commercial: 900,
        rv: 800,
        unknown: 450,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'other' as const,
      baseCents: 10000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
  ],
  surcharges: [],
  fixedLineItems: [{ code: 'admin_fee', label: 'Admin fee', amountCents: 500 }],
};

export async function seedDefaultRateSheet(ctx: TestContext, tenantId: string): Promise<string> {
  const c = await ctx.admin.connect();
  try {
    await c.query('BEGIN');
    const sheetIdRes = await c.query<{ id: string }>(
      `INSERT INTO rate_sheets (id, tenant_id, name, definition, active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, 'Test Default', $2::jsonb, true, now(), now())
       RETURNING id`,
      [tenantId, JSON.stringify(DEFAULT_TEST_RATE_SHEET)],
    );
    const sheetId = sheetIdRes.rows[0]?.id as string;
    await c.query(
      `INSERT INTO tenant_default_rate_sheets (tenant_id, rate_sheet_id, updated_at)
       VALUES ($1::uuid, $2::uuid, now())
       ON CONFLICT (tenant_id) DO UPDATE SET rate_sheet_id = EXCLUDED.rate_sheet_id, updated_at = now()`,
      [tenantId, sheetId],
    );
    await c.query('COMMIT');
    return sheetId;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function getAuditLogCount(
  ctx: TestContext,
  tenantId: string,
  resourceType: string,
  resourceId?: string,
): Promise<number> {
  const c = await ctx.admin.connect();
  try {
    const params: unknown[] = [tenantId, resourceType];
    let q = `SELECT count(*)::int AS n FROM audit_log
             WHERE tenant_id = $1::uuid AND resource_type = $2`;
    if (resourceId) {
      q += ' AND resource_id = $3::uuid';
      params.push(resourceId);
    }
    const r = await c.query<{ n: number }>(q, params);
    return r.rows[0]?.n ?? 0;
  } finally {
    c.release();
  }
}
