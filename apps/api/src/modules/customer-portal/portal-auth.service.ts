/**
 * PortalAuthService — auth + host resolution for the white-label customer
 * portal (Session 32).
 *
 * Host resolution: the portal is multi-tenant by Host header. A request to
 * portal.acme-towing.com (a verified custom domain) or acme.portal.<base>
 * (the always-available fallback subdomain) resolves to a tenant BEFORE any
 * login. Resolution runs on the admin pool (RLS-bypassing) because the
 * tenant is not yet known — exactly the pattern PaymentsPublicController uses.
 *
 * Signup is email-gated (model C): we only create a portal login when the
 * submitted email matches a `customers` row in the resolved tenant. No match,
 * or an already-registered email, returns the same neutral { ok: true } as a
 * success — no account enumeration. Same for forgot-password.
 *
 * Auth is fully separate from staff: separate table (customer_portal_users),
 * separate JWT (audience -portal, dedicated key), separate guard. Passwords
 * reuse the staff PasswordService (argon2id); verify/reset tokens reuse the
 * staff token helpers (sha256 at rest, single-use).
 */
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  customerPortalAuthTokens,
  customerPortalUsers,
  customers,
  tenantBranding,
  tenants,
  uuidv7,
} from '@ustowdispatch/db';
import {
  ERROR_CODES,
  type PortalAuthResponse,
  type PortalBrandingDto,
  type PortalForgotPasswordPayload,
  type PortalLoginPayload,
  type PortalResetPasswordPayload,
  type PortalSignupPayload,
  type PortalUserDto,
} from '@ustowdispatch/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { generatePlainToken, hashToken } from '../auth/auth-tokens.util.js';
import { JwtService } from '../auth/jwt.service.js';
import { PasswordService } from '../auth/password.service.js';
import { EmailService } from '../email/email.service.js';
import { buildPortalUrl, extractSubdomainSlug, normalizeHost } from './portal-host.util.js';

const VERIFY_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_MINUTES = 60;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
}

export interface PortalCallerCtx {
  portalUserId: string;
  customerId: string;
  tenantId: string;
}

@Injectable()
export class PortalAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantDb: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly jwt: JwtService,
    private readonly password: PasswordService,
    private readonly email: EmailService,
  ) {}

  // ===========================================================================
  // HOST RESOLUTION + BRANDING (public, pre-login)
  // ===========================================================================

  /**
   * Map a Host header to a tenant. Order:
   *   1. verified custom domain (tenant_branding.custom_domain, exact match,
   *      custom_domain_verified_at set) — squat-proof: an unverified domain
   *      never routes, even though the string is reserved by the unique index.
   *   2. fallback subdomain <slug>.<PORTAL_BASE_DOMAIN>.
   * Returns null when the host maps to nothing or the tenant is inactive.
   */
  async resolveTenantByHost(rawHost: string): Promise<ResolvedTenant | null> {
    const host = normalizeHost(rawHost);
    if (!host) return null;

    return this.admin.runAsAdmin({}, async (db) => {
      // 1. verified custom domain
      const branding = await db.query.tenantBranding.findFirst({
        where: and(
          sql`lower(${tenantBranding.customDomain}) = ${host}`,
          sql`${tenantBranding.customDomainVerifiedAt} IS NOT NULL`,
        ),
      });
      if (branding) {
        const t = await db.query.tenants.findFirst({
          where: and(eq(tenants.id, branding.tenantId), isNull(tenants.deletedAt)),
          columns: { id: true, slug: true, name: true, status: true },
        });
        if (t && t.status === 'active') return { id: t.id, slug: t.slug, name: t.name };
      }

      // 2. fallback subdomain <slug>.<base>
      const slug = extractSubdomainSlug(host, this.config.portal.baseDomain);
      if (slug) {
        const t = await db.query.tenants.findFirst({
          where: and(eq(tenants.slug, slug), isNull(tenants.deletedAt)),
          columns: { id: true, slug: true, name: true, status: true },
        });
        if (t && t.status === 'active') return { id: t.id, slug: t.slug, name: t.name };
      }
      return null;
    });
  }

  /** Public branding for a host. Throws 404 when the host maps to nothing. */
  async branding(rawHost: string): Promise<PortalBrandingDto> {
    const tenant = await this.requireTenant(rawHost);
    const row = await this.admin.runAsAdmin({}, async (db) =>
      db.query.tenantBranding.findFirst({ where: eq(tenantBranding.tenantId, tenant.id) }),
    );
    return {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      logoUrl: row?.logoUrl ?? null,
      primaryColor: row?.primaryColor ?? null,
      accentColor: row?.accentColor ?? null,
      supportEmail: row?.supportEmail ?? null,
      supportPhone: row?.supportPhone ?? null,
      termsUrl: row?.termsUrl ?? null,
      privacyUrl: row?.privacyUrl ?? null,
    };
  }

  // ===========================================================================
  // SIGNUP (email-gated — model C)
  // ===========================================================================
  async signup(rawHost: string, input: PortalSignupPayload): Promise<{ ok: true }> {
    const tenant = await this.requireTenant(rawHost);
    // Hash unconditionally so the no-customer path burns the same argon2 work.
    const passwordHash = await this.password.hash(input.password);
    const verifyPlain = generatePlainToken();

    const created = await this.admin.runAsAdmin({}, async (db) => {
      const customer = await db.query.customers.findFirst({
        where: and(
          eq(customers.tenantId, tenant.id),
          sql`lower(${customers.email}) = ${input.email}`,
          isNull(customers.deletedAt),
        ),
      });
      if (!customer) return null;

      const existing = await db.query.customerPortalUsers.findFirst({
        where: and(
          eq(customerPortalUsers.tenantId, tenant.id),
          sql`lower(${customerPortalUsers.email}) = ${input.email}`,
          isNull(customerPortalUsers.deletedAt),
        ),
      });
      if (existing) return null; // already registered — neutral response, no leak

      const portalUserId = uuidv7();
      await db.insert(customerPortalUsers).values({
        id: portalUserId,
        tenantId: tenant.id,
        customerId: customer.id,
        email: input.email,
        passwordHash,
      });
      await db.insert(customerPortalAuthTokens).values({
        id: uuidv7(),
        tenantId: tenant.id,
        portalUserId,
        purpose: 'email_verification',
        tokenHash: hashToken(verifyPlain),
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      });
      return { customerName: customer.name };
    });

    if (created) {
      const verifyUrl = buildPortalUrl(rawHost, '/portal/verify-email', verifyPlain);
      void this.email
        .sendPortalVerificationEmail({
          to: input.email,
          name: created.customerName,
          tenantName: tenant.name,
          verifyUrl,
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  // ===========================================================================
  // LOGIN
  // ===========================================================================
  async login(rawHost: string, input: PortalLoginPayload): Promise<PortalAuthResponse> {
    const tenant = await this.requireTenant(rawHost);

    const found = await this.admin.runAsAdmin({}, async (db) => {
      const user = await db.query.customerPortalUsers.findFirst({
        where: and(
          eq(customerPortalUsers.tenantId, tenant.id),
          sql`lower(${customerPortalUsers.email}) = ${input.email}`,
          isNull(customerPortalUsers.deletedAt),
        ),
      });
      if (!user) return null;
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, user.customerId),
        columns: { name: true },
      });
      return { user, customerName: customer?.name ?? 'Customer' };
    });

    if (!found) {
      // Burn argon2 work so a missing account isn't faster than a wrong password.
      await this.password.hash(input.password);
      throw invalidCreds();
    }
    const { user, customerName } = found;

    if (!user.isActive) throw invalidCreds();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: ERROR_CODES.ACCOUNT_LOCKED,
        message: 'Account locked due to repeated failed logins. Try again later.',
      });
    }

    const ok = await this.password.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.recordFailedLogin(tenant.id, user.id, user.failedLoginCount ?? 0);
      throw invalidCreds();
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({
        code: ERROR_CODES.EMAIL_NOT_VERIFIED,
        message: 'Please verify your email before signing in. Check your inbox.',
      });
    }

    await this.tenantDb.runInTenantContext({ tenantId: tenant.id, userId: user.id }, async (tx) => {
      await tx
        .update(customerPortalUsers)
        .set({
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(customerPortalUsers.id, user.id));
    });

    const accessToken = await this.jwt.signPortal({
      sub: user.id,
      cid: user.customerId,
      tid: tenant.id,
      jti: uuidv7(),
    });
    return {
      accessToken,
      expiresIn: this.jwt.portalTtlSeconds(),
      user: this.toUserDto(user, customerName, true),
    };
  }

  // ===========================================================================
  // EMAIL VERIFICATION
  // ===========================================================================
  async verifyEmail(token: string): Promise<{ ok: true }> {
    const tokenHash = hashToken(token);
    const verified = await this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.customerPortalAuthTokens.findFirst({
        where: and(
          eq(customerPortalAuthTokens.tokenHash, tokenHash),
          eq(customerPortalAuthTokens.purpose, 'email_verification'),
          isNull(customerPortalAuthTokens.consumedAt),
          gt(customerPortalAuthTokens.expiresAt, new Date()),
        ),
      });
      if (!row) return null;
      await db
        .update(customerPortalUsers)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(customerPortalUsers.id, row.portalUserId));
      await db
        .update(customerPortalAuthTokens)
        .set({ consumedAt: new Date() })
        .where(eq(customerPortalAuthTokens.id, row.id));
      return true;
    });
    if (!verified) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Verification link is invalid or expired.',
      });
    }
    return { ok: true };
  }

  // ===========================================================================
  // FORGOT / RESET PASSWORD
  // ===========================================================================
  async forgotPassword(rawHost: string, input: PortalForgotPasswordPayload): Promise<{ ok: true }> {
    const tenant = await this.requireTenant(rawHost);
    const resetPlain = generatePlainToken();

    const sent = await this.admin.runAsAdmin({}, async (db) => {
      const user = await db.query.customerPortalUsers.findFirst({
        where: and(
          eq(customerPortalUsers.tenantId, tenant.id),
          sql`lower(${customerPortalUsers.email}) = ${input.email}`,
          isNull(customerPortalUsers.deletedAt),
        ),
      });
      if (!user || !user.isActive) return null;
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, user.customerId),
        columns: { name: true },
      });
      await db.insert(customerPortalAuthTokens).values({
        id: uuidv7(),
        tenantId: tenant.id,
        portalUserId: user.id,
        purpose: 'password_reset',
        tokenHash: hashToken(resetPlain),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
      });
      return { email: user.email, name: customer?.name ?? 'Customer' };
    });

    if (sent) {
      const resetUrl = buildPortalUrl(rawHost, '/portal/reset-password', resetPlain);
      void this.email
        .sendPortalPasswordResetEmail({
          to: sent.email,
          name: sent.name,
          tenantName: tenant.name,
          resetUrl,
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  async resetPassword(input: PortalResetPasswordPayload): Promise<{ ok: true }> {
    const tokenHash = hashToken(input.token);
    const newHash = await this.password.hash(input.newPassword);

    const updated = await this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.customerPortalAuthTokens.findFirst({
        where: and(
          eq(customerPortalAuthTokens.tokenHash, tokenHash),
          eq(customerPortalAuthTokens.purpose, 'password_reset'),
          isNull(customerPortalAuthTokens.consumedAt),
          gt(customerPortalAuthTokens.expiresAt, new Date()),
        ),
      });
      if (!row) return null;
      await db
        .update(customerPortalUsers)
        .set({
          passwordHash: newHash,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(customerPortalUsers.id, row.portalUserId));
      await db
        .update(customerPortalAuthTokens)
        .set({ consumedAt: new Date() })
        .where(eq(customerPortalAuthTokens.id, row.id));
      return true;
    });

    if (!updated) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Reset link is invalid or expired.',
      });
    }
    return { ok: true };
  }

  // ===========================================================================
  // /portal/me
  // ===========================================================================
  async me(ctx: PortalCallerCtx): Promise<PortalUserDto> {
    const found = await this.tenantDb.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.portalUserId },
      async (tx) => {
        const user = await tx.query.customerPortalUsers.findFirst({
          where: and(
            eq(customerPortalUsers.id, ctx.portalUserId),
            isNull(customerPortalUsers.deletedAt),
          ),
        });
        if (!user) return null;
        const customer = await tx.query.customers.findFirst({
          where: eq(customers.id, user.customerId),
          columns: { name: true },
        });
        return { user, customerName: customer?.name ?? 'Customer' };
      },
    );
    if (!found) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Portal user not found',
      });
    }
    return this.toUserDto(found.user, found.customerName, !!found.user.emailVerifiedAt);
  }

  // ===========================================================================
  // INTERNALS
  // ===========================================================================
  private async requireTenant(rawHost: string): Promise<ResolvedTenant> {
    const tenant = await this.resolveTenantByHost(rawHost);
    if (!tenant) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'No customer portal is configured for this address.',
      });
    }
    return tenant;
  }

  private async recordFailedLogin(
    tenantId: string,
    userId: string,
    prevCount: number,
  ): Promise<void> {
    const next = prevCount + 1;
    const lockUntil =
      next >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
    await this.tenantDb.runInTenantContext({ tenantId, userId }, async (tx) => {
      await tx
        .update(customerPortalUsers)
        .set({ failedLoginCount: next, lockedUntil: lockUntil, updatedAt: new Date() })
        .where(eq(customerPortalUsers.id, userId));
    });
  }

  private toUserDto(
    user: typeof customerPortalUsers.$inferSelect,
    customerName: string,
    emailVerified: boolean,
  ): PortalUserDto {
    return {
      id: user.id,
      email: user.email,
      customerName,
      emailVerified,
    };
  }
}

function invalidCreds(): UnauthorizedException {
  return new UnauthorizedException({
    code: ERROR_CODES.INVALID_CREDENTIALS,
    message: 'Invalid email or password',
  });
}
