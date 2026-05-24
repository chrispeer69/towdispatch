/**
 * Integration tests for the White-Label Customer Portal services (Session 32),
 * exercised against a real database (self-skips when none is configured).
 *
 *   PortalAuthService:    host resolution → signup (email-gated) → email
 *                         verification → login. Confirms the unverified-login
 *                         gate and that the issued token binds the customer.
 *   PortalAccountService: cross-customer isolation — two portal users in the
 *                         same tenant each see ONLY their own customer's jobs;
 *                         pay-link works for an owned invoice and 404s for
 *                         another customer's invoice (the advisor's flagged
 *                         app-layer guard that RLS does not provide).
 *
 * Dependencies are constructed by hand with typed fake configs (ConfigService
 * reads process.env at construction, which we avoid) and a stub EmailService
 * that captures the verification URL so we can drive the real verify flow.
 */
import { uuidv7 } from '@ustowdispatch/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service.js';
import { TenantAwareDb } from '../src/database/tenant-aware-db.service.js';
import { TransactionRunner } from '../src/database/transaction-runner.service.js';
import { JwtService } from '../src/modules/auth/jwt.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { PortalAccountService } from '../src/modules/customer-portal/portal-account.service.js';
import {
  PortalAuthService,
  type PortalCallerCtx,
} from '../src/modules/customer-portal/portal-auth.service.js';
import type { EmailService } from '../src/modules/email/email.service.js';

const { Pool } = pg;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const skip = !ADMIN_URL || !APP_URL;
const d = skip ? describe.skip : describe;

const BASE_DOMAIN = 'portal.test.local';
const PASSWORD = 'Sup3rSecret-pw';

const jwtConfig = {
  jwt: {
    accessSecret: 'access-secret-key-at-least-32-chars-padding',
    refreshSecret: 'refresh-secret-key-at-least-32-chars-pad',
    mfaSecret: 'mfa-secret-key-at-least-32-characters-pad',
    driverSecret: 'driver-secret-key-at-least-32-chars-pad-x',
    portalSecret: 'portal-secret-key-at-least-32-chars-pad-x',
    accessTtl: '15m',
    refreshTtl: '30d',
    driverTtl: '12h',
    portalTtl: '24h',
    issuer: 'ustowdispatch',
    audience: 'ustowdispatch-api',
  },
} as unknown as ConfigService;

const portalConfig = { portal: { baseDomain: BASE_DOMAIN } } as unknown as ConfigService;
const accountConfig = { webPublicUrl: 'http://localhost:3000' } as unknown as ConfigService;

d('Customer portal services (integration)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let auth: PortalAuthService;
  let account: PortalAccountService;
  const captured: { verifyUrl?: string } = {};

  let tenantId: string;
  const slug = `wl-svc-${Date.now()}`;
  const host = `${slug}.${BASE_DOMAIN}`;
  let customerA: string;
  let customerB: string;
  let invoiceA: string;
  let invoiceB: string;
  const emailA = `cust-a-${Date.now()}@example.com`;

  async function adminExec(sql: string, params: unknown[] = []): Promise<void> {
    const c = await admin.connect();
    try {
      await c.query(sql, params);
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantId = uuidv7();
    customerA = uuidv7();
    customerB = uuidv7();
    invoiceA = uuidv7();
    invoiceB = uuidv7();
    const jobA = uuidv7();
    const jobB = uuidv7();

    await adminExec("INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')", [
      tenantId,
      slug,
      'WL Svc Tenant',
    ]);
    await adminExec(
      `INSERT INTO customers (id, tenant_id, name, email)
       VALUES ($1, $2, 'Cust A', $3), ($4, $5, 'Cust B', 'cust-b@example.com')`,
      [customerA, tenantId, emailA, customerB, tenantId],
    );
    await adminExec(
      `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by, customer_id)
       VALUES ($1, $2, 'J-A', 'tow', '1 A St', 'customer', $3),
              ($4, $5, 'J-B', 'tow', '1 B St', 'customer', $6)`,
      [jobA, tenantId, customerA, jobB, tenantId, customerB],
    );
    await adminExec(
      `INSERT INTO invoices (id, tenant_id, invoice_number, status, customer_id, job_id, total_cents, balance_cents)
       VALUES ($1, $2, 'INV-A', 'issued', $3, $4, 5000, 5000),
              ($5, $6, 'INV-B', 'issued', $7, $8, 9000, 9000)`,
      [invoiceA, tenantId, customerA, jobA, invoiceB, tenantId, customerB, jobB],
    );

    const emailStub = {
      sendPortalVerificationEmail: async (o: { verifyUrl: string }) => {
        captured.verifyUrl = o.verifyUrl;
      },
      sendPortalPasswordResetEmail: async () => undefined,
    } as unknown as EmailService;

    const tenantDb = new TenantAwareDb(app, app, portalConfig);
    const runner = new TransactionRunner(admin);
    auth = new PortalAuthService(
      portalConfig,
      tenantDb,
      runner,
      new JwtService(jwtConfig),
      new PasswordService(),
      emailStub,
    );
    account = new PortalAccountService(tenantDb, accountConfig);
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM customer_portal_auth_tokens WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM customer_portal_users WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM invoices WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM jobs WHERE tenant_id = $1', [tenantId]);
        await c.query('DELETE FROM customers WHERE tenant_id = $1', [tenantId]);
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
    if (app) await app.end();
  });

  it('resolves the tenant from the fallback subdomain host', async () => {
    const branding = await auth.branding(host);
    expect(branding.tenantSlug).toBe(slug);
    expect(branding.tenantName).toBe('WL Svc Tenant');
  });

  it('signup is email-gated and emails a verification link', async () => {
    const res = await auth.signup(host, { email: emailA, password: PASSWORD });
    expect(res.ok).toBe(true);
    // fire-and-forget email — let the microtask settle, then read the captured URL.
    await new Promise((r) => setTimeout(r, 0));
    expect(captured.verifyUrl).toContain('/portal/verify-email?token=');
  });

  it('signup for an email with no matching customer still returns ok (no leak)', async () => {
    const res = await auth.signup(host, {
      email: `nobody-${Date.now()}@example.com`,
      password: PASSWORD,
    });
    expect(res.ok).toBe(true);
  });

  it('login is blocked until the email is verified', async () => {
    await expect(auth.login(host, { email: emailA, password: PASSWORD })).rejects.toMatchObject({
      response: { code: 'email_not_verified' },
    });
  });

  it('verify → login issues a token bound to the customer', async () => {
    const token = new URL(captured.verifyUrl as string).searchParams.get('token');
    expect(token).toBeTruthy();
    const verified = await auth.verifyEmail(token as string);
    expect(verified.ok).toBe(true);

    const login = await auth.login(host, { email: emailA, password: PASSWORD });
    expect(login.user.emailVerified).toBe(true);
    expect(login.user.customerName).toBe('Cust A');
    expect(login.accessToken.length).toBeGreaterThan(20);

    const claims = await new JwtService(jwtConfig).verifyPortal(login.accessToken);
    expect(claims.cid).toBe(customerA);
    expect(claims.tid).toBe(tenantId);
  });

  it('login with a wrong password is rejected', async () => {
    await expect(
      auth.login(host, { email: emailA, password: 'wrong-password-x' }),
    ).rejects.toMatchObject({ response: { code: 'invalid_credentials' } });
  });

  // ------------------- cross-customer isolation (app layer) -------------------

  it('a portal user sees ONLY their own customer’s jobs', async () => {
    const ctxA = ctxFor(customerA);
    const ctxB = ctxFor(customerB);
    const aJobs = await account.listJobs(ctxA);
    const bJobs = await account.listJobs(ctxB);
    expect(aJobs.jobs.map((j) => j.jobNumber)).toEqual(['J-A']);
    expect(bJobs.jobs.map((j) => j.jobNumber)).toEqual(['J-B']);
  });

  it('pay-link works for an owned invoice and 404s for another customer’s invoice', async () => {
    const ctxA = ctxFor(customerA);
    const link = await account.payLink(ctxA, invoiceA);
    expect(link.payUrl).toContain('/pay/');

    await expect(account.payLink(ctxA, invoiceB)).rejects.toMatchObject({
      response: { code: 'not_found' },
    });
  });

  function ctxFor(customerId: string): PortalCallerCtx {
    return { portalUserId: uuidv7(), customerId, tenantId };
  }
});
