/**
 * SsoService — orchestrates Enterprise SSO (Session 38).
 *
 *   * Connection CRUD (admin), running in the caller's tenant RLS context.
 *   * SP-initiated login: resolve tenant-by-slug + connection (admin pool,
 *     since the IdP request carries no JWT), build the redirect, validate the
 *     IdP callback, JIT-provision the user, and mint a SESSION via
 *     AuthService.issueSsoTokens (identical shape to password login).
 *   * Append-only login audit on every attempt.
 *
 * The env gate (ConfigService.enterpriseSso) is enforced on every public
 * entry point: disabled or non-allowlisted tenants get a clean 403.
 */
import { randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ScimToken,
  type SsoConnection,
  type SsoProvider,
  scimTokens,
  ssoConnections,
  ssoLoginAudit,
  tenants,
  users,
} from '@ustowdispatch/db/schema';
import {
  type CreateSsoConnectionPayload,
  ERROR_CODES,
  type MintScimTokenPayload,
  type MintScimTokenResponse,
  type Role,
  type ScimTokenDto,
  type SsoConnectionDto,
  type SsoLoginAuditDto,
  type UpdateSsoConnectionPayload,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { generatePlainToken, hashToken } from '../auth/auth-tokens.util.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { type MappedUser, mapClaimsToUser } from './attribute-mapping.js';
import { SsoSecretService } from './sso-secret.service.js';

export interface SsoCallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

export interface SsoLoginMeta {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface SsoSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string };
  tenant: { id: string; slug: string };
}

export interface ResolvedConnection {
  tenant: { id: string; slug: string; name: string };
  connection: SsoConnection;
}

@Injectable()
export class SsoService {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantDb: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly auth: AuthService,
    private readonly password: PasswordService,
    private readonly secrets: SsoSecretService,
  ) {}

  // =========================================================================
  // URL helpers
  // =========================================================================
  /** Absolute IdP-facing URLs derived from the tenant slug. */
  connectionUrls(slug: string): {
    samlLogin: string;
    oidcLogin: string;
    acs: string;
    oidcRedirect: string;
    spEntityId: string;
  } {
    const base = this.config.apiPublicUrl;
    return {
      samlLogin: `${base}/sso/${slug}/saml/login`,
      oidcLogin: `${base}/sso/${slug}/oidc/login`,
      acs: `${base}/sso/${slug}/saml/acs`,
      oidcRedirect: `${base}/sso/${slug}/oidc/callback`,
      spEntityId: `${base}/sso/${slug}/saml`,
    };
  }

  // =========================================================================
  // Env gate
  // =========================================================================
  /** Throws 403 sso_disabled / sso_tenant_not_allowed when the gate is shut. */
  assertTenantAllowed(tenantId: string): void {
    const gate = this.config.enterpriseSso;
    if (!gate.enabled) {
      throw new ForbiddenException({
        code: ERROR_CODES.SSO_DISABLED,
        message: 'Enterprise SSO is disabled for this deployment',
      });
    }
    if (!gate.isTenantAllowed(tenantId)) {
      throw new ForbiddenException({
        code: ERROR_CODES.SSO_TENANT_NOT_ALLOWED,
        message: 'Enterprise SSO is not enabled for this tenant',
      });
    }
  }

  // =========================================================================
  // Connection CRUD (admin, tenant RLS context)
  // =========================================================================
  async listConnections(ctx: SsoCallerCtx): Promise<SsoConnectionDto[]> {
    this.assertTenantAllowed(ctx.tenantId);
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const slug = await this.tenantSlug(tx, ctx.tenantId);
      const rows = await tx.query.ssoConnections.findMany({
        where: isNull(ssoConnections.deletedAt),
        orderBy: (t, { asc }) => [asc(t.provider)],
      });
      return rows.map((r) => this.toDto(r, slug));
    });
  }

  async getConnection(ctx: SsoCallerCtx, id: string): Promise<SsoConnectionDto> {
    this.assertTenantAllowed(ctx.tenantId);
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const slug = await this.tenantSlug(tx, ctx.tenantId);
      const row = await tx.query.ssoConnections.findFirst({
        where: and(eq(ssoConnections.id, id), isNull(ssoConnections.deletedAt)),
      });
      if (!row) throw this.notFound();
      return this.toDto(row, slug);
    });
  }

  async createConnection(
    ctx: SsoCallerCtx,
    input: CreateSsoConnectionPayload,
  ): Promise<SsoConnectionDto> {
    this.assertTenantAllowed(ctx.tenantId);
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const slug = await this.tenantSlug(tx, ctx.tenantId);
      const id = uuidv7();
      const [row] = await tx
        .insert(ssoConnections)
        .values({
          id,
          tenantId: ctx.tenantId,
          provider: input.provider,
          displayName: input.displayName,
          issuer: input.issuer ?? null,
          metadataUrl: input.metadataUrl ?? null,
          x509Cert: input.x509Cert ?? null,
          ssoUrl: input.ssoUrl ?? null,
          sloUrl: input.sloUrl ?? null,
          audience: input.audience ?? null,
          oidcClientId: input.oidcClientId ?? null,
          oidcClientSecretEncrypted: input.oidcClientSecret
            ? this.secrets.encrypt(input.oidcClientSecret)
            : null,
          ...(input.oidcScopes ? { oidcScopes: input.oidcScopes } : {}),
          ...(input.attributeMapping ? { attributeMapping: input.attributeMapping } : {}),
          ...(input.defaultRole ? { defaultRole: input.defaultRole } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('sso_connections insert returning() yielded no row');
      return this.toDto(row, slug);
    });
  }

  async updateConnection(
    ctx: SsoCallerCtx,
    id: string,
    input: UpdateSsoConnectionPayload,
  ): Promise<SsoConnectionDto> {
    this.assertTenantAllowed(ctx.tenantId);
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const slug = await this.tenantSlug(tx, ctx.tenantId);
      const patch: Partial<typeof ssoConnections.$inferInsert> = {};
      if (input.displayName !== undefined) patch.displayName = input.displayName;
      if (input.issuer !== undefined) patch.issuer = input.issuer;
      if (input.metadataUrl !== undefined) patch.metadataUrl = input.metadataUrl;
      if (input.x509Cert !== undefined) patch.x509Cert = input.x509Cert;
      if (input.ssoUrl !== undefined) patch.ssoUrl = input.ssoUrl;
      if (input.sloUrl !== undefined) patch.sloUrl = input.sloUrl;
      if (input.audience !== undefined) patch.audience = input.audience;
      if (input.oidcClientId !== undefined) patch.oidcClientId = input.oidcClientId;
      if (input.oidcClientSecret !== undefined) {
        patch.oidcClientSecretEncrypted = this.secrets.encrypt(input.oidcClientSecret);
      }
      if (input.oidcScopes !== undefined) patch.oidcScopes = input.oidcScopes;
      if (input.attributeMapping !== undefined) patch.attributeMapping = input.attributeMapping;
      if (input.defaultRole !== undefined) patch.defaultRole = input.defaultRole;
      if (input.enabled !== undefined) patch.enabled = input.enabled;

      const [row] = await tx
        .update(ssoConnections)
        .set(patch)
        .where(and(eq(ssoConnections.id, id), isNull(ssoConnections.deletedAt)))
        .returning();
      if (!row) throw this.notFound();
      return this.toDto(row, slug);
    });
  }

  async deleteConnection(ctx: SsoCallerCtx, id: string): Promise<void> {
    this.assertTenantAllowed(ctx.tenantId);
    await this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .update(ssoConnections)
        .set({ deletedAt: new Date(), enabled: false })
        .where(and(eq(ssoConnections.id, id), isNull(ssoConnections.deletedAt)))
        .returning();
      if (!row) throw this.notFound();
    });
  }

  async listLoginAudit(ctx: SsoCallerCtx, limit = 100): Promise<SsoLoginAuditDto[]> {
    this.assertTenantAllowed(ctx.tenantId);
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.ssoLoginAudit.findMany({
        orderBy: [desc(ssoLoginAudit.occurredAt)],
        limit: Math.min(limit, 500),
      });
      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        connectionId: r.connectionId,
        userId: r.userId,
        provider: (r.provider as 'saml' | 'oidc' | null) ?? null,
        outcome: r.outcome,
        failureReason: r.failureReason,
        subject: r.subject,
        ip: r.ip,
        occurredAt: r.occurredAt.toISOString(),
      }));
    });
  }

  // =========================================================================
  // SCIM token management (admin, tenant RLS context)
  // =========================================================================
  async listScimTokens(ctx: SsoCallerCtx): Promise<ScimTokenDto[]> {
    this.assertTenantAllowed(ctx.tenantId);
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.scimTokens.findMany({
        where: isNull(scimTokens.deletedAt),
        orderBy: [desc(scimTokens.createdAt)],
      });
      return rows.map((r) => this.toTokenDto(r));
    });
  }

  async mintScimToken(
    ctx: SsoCallerCtx,
    input: MintScimTokenPayload,
  ): Promise<MintScimTokenResponse> {
    this.assertTenantAllowed(ctx.tenantId);
    // `scim_` prefix makes the credential self-identifying in logs/leak scans.
    const plain = `scim_${generatePlainToken()}`;
    const tokenHash = hashToken(plain);
    const tokenPrefix = `${plain.slice(0, 13)}…`;
    const expiresAt =
      input.expiresInDays !== undefined
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

    const record = await this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(scimTokens)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          connectionId: input.connectionId ?? null,
          name: input.name,
          tokenHash,
          tokenPrefix,
          ...(input.scopes ? { scopes: input.scopes } : {}),
          expiresAt,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('scim_tokens insert returning() yielded no row');
      return this.toTokenDto(row);
    });
    return { token: plain, record };
  }

  async revokeScimToken(ctx: SsoCallerCtx, id: string): Promise<void> {
    this.assertTenantAllowed(ctx.tenantId);
    await this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .update(scimTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(scimTokens.id, id), isNull(scimTokens.deletedAt), isNull(scimTokens.revokedAt)),
        )
        .returning();
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'SCIM token not found',
        });
      }
    });
  }

  private toTokenDto(row: ScimToken): ScimTokenDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      connectionId: row.connectionId,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      scopes: row.scopes,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // =========================================================================
  // Login resolution (admin pool — no tenant context on the wire yet)
  // =========================================================================
  /**
   * Resolve the active, enabled connection for (tenant slug, provider). Uses
   * the admin pool because the IdP request has no JWT. Enforces the env gate
   * and the per-connection `enabled` flag. Throws typed errors otherwise.
   */
  async resolveActiveConnection(slug: string, provider: SsoProvider): Promise<ResolvedConnection> {
    const resolved = await this.admin.runAsAdmin({}, async (db) => {
      const tenant = await db.query.tenants.findFirst({
        where: and(eq(tenants.slug, slug), isNull(tenants.deletedAt)),
        columns: { id: true, slug: true, name: true },
      });
      if (!tenant) return null;
      const connection = await db.query.ssoConnections.findFirst({
        where: and(
          eq(ssoConnections.tenantId, tenant.id),
          eq(ssoConnections.provider, provider),
          isNull(ssoConnections.deletedAt),
        ),
      });
      return { tenant, connection: connection ?? null };
    });
    if (!resolved || !resolved.connection) {
      throw new NotFoundException({
        code: ERROR_CODES.SSO_CONNECTION_NOT_FOUND,
        message: 'No SSO connection for this tenant/provider',
      });
    }
    this.assertTenantAllowed(resolved.tenant.id);
    if (!resolved.connection.enabled) {
      throw new ForbiddenException({
        code: ERROR_CODES.SSO_DISABLED,
        message: 'This SSO connection is disabled',
      });
    }
    return { tenant: resolved.tenant, connection: resolved.connection };
  }

  /** Decrypt a connection's OIDC client secret (empty when unset). */
  decryptOidcSecret(connection: SsoConnection): string {
    if (!connection.oidcClientSecretEncrypted) return '';
    return this.secrets.decrypt(connection.oidcClientSecretEncrypted);
  }

  // =========================================================================
  // Provisioning + token mint
  // =========================================================================
  /**
   * JIT-provision (or update) the local user from verified claims, then mint
   * a session through AuthService (identical shape to password login). Writes
   * a success audit row. Throws on provisioning failure (caller writes a fail
   * audit row).
   */
  async completeLogin(
    resolved: ResolvedConnection,
    verified: { subject: string; claims: Record<string, unknown> },
    provider: SsoProvider,
    meta: SsoLoginMeta,
  ): Promise<SsoSessionResult> {
    const { tenant, connection } = resolved;
    const mapped = mapClaimsToUser(verified.claims, connection.attributeMapping, {
      nameId: verified.subject,
      defaultRole: connection.defaultRole as Role,
    });

    const user = await this.provisionUser(tenant.id, connection.id, mapped, verified.subject);

    const tokens = await this.auth.issueSsoTokens(
      { tenantId: tenant.id, userId: user.id, role: user.role },
      {
        ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
        ...(meta.ipAddress !== undefined ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
      },
    );

    await this.recordAudit({
      tenantId: tenant.id,
      connectionId: connection.id,
      userId: user.id,
      provider,
      outcome: 'success',
      subject: verified.subject,
      meta,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: { id: user.id, email: user.email },
      tenant: { id: tenant.id, slug: tenant.slug },
    };
  }

  private async provisionUser(
    tenantId: string,
    connectionId: string,
    mapped: MappedUser,
    subject: string,
  ): Promise<{ id: string; email: string; role: string }> {
    const ctx: SsoCallerCtx = { tenantId, userId: SYSTEM_ACTOR, requestId: uuidv7() };
    return this.tenantDb.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.users.findFirst({
        where: and(
          eq(users.tenantId, tenantId),
          eq(users.email, mapped.email),
          isNull(users.deletedAt),
        ),
      });
      if (existing) {
        // Link to the connection + stamp login. We do NOT overwrite an
        // existing user's role from the IdP on every login — operators may
        // have promoted/demoted locally. Role is only set at creation.
        await tx
          .update(users)
          .set({
            lastLoginAt: new Date(),
            ssoConnectionId: connectionId,
            externalId: existing.externalId ?? subject,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id));
        return { id: existing.id, email: existing.email, role: existing.role };
      }

      // JIT create. Password is a random unusable hash — these accounts log
      // in via the IdP, never a password.
      const id = uuidv7();
      const passwordHash = await this.password.hash(randomBytes(32).toString('hex'));
      const [row] = await tx
        .insert(users)
        .values({
          id,
          tenantId,
          email: mapped.email,
          emailVerifiedAt: new Date(),
          passwordHash,
          firstName: mapped.firstName || mapped.email.split('@')[0] || 'SSO',
          lastName: mapped.lastName || 'User',
          role: mapped.role,
          isActive: true,
          lastLoginAt: new Date(),
          externalId: subject,
          ssoConnectionId: connectionId,
        })
        .returning();
      if (!row) throw new Error('users insert returning() yielded no row');
      return { id: row.id, email: row.email, role: row.role };
    });
  }

  // =========================================================================
  // Audit
  // =========================================================================
  async recordAudit(input: {
    tenantId: string;
    connectionId: string | null;
    userId: string | null;
    provider: SsoProvider | null;
    outcome: 'success' | 'fail' | 'denied';
    failureReason?: string | undefined;
    subject?: string | undefined;
    meta: SsoLoginMeta;
  }): Promise<void> {
    // Audit always goes through the admin pool so a failed login (no user, no
    // tenant context) still records. tenant_id is set explicitly.
    await this.admin.runAsAdmin({ ...(input.userId ? { actorUserId: input.userId } : {}) }, (db) =>
      db.insert(ssoLoginAudit).values({
        id: uuidv7(),
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        userId: input.userId,
        provider: input.provider,
        outcome: input.outcome,
        failureReason: input.failureReason ?? null,
        subject: input.subject ?? null,
        ip: input.meta.ipAddress ?? null,
        userAgent: input.meta.userAgent ?? null,
      }),
    );
  }

  // =========================================================================
  // helpers
  // =========================================================================
  private async tenantSlug(tx: Tx, tenantId: string): Promise<string> {
    const t = await tx.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { slug: true },
    });
    return t?.slug ?? 'unknown';
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ERROR_CODES.SSO_CONNECTION_NOT_FOUND,
      message: 'SSO connection not found',
    });
  }

  private toDto(row: SsoConnection, slug: string): SsoConnectionDto {
    const urls = this.connectionUrls(slug);
    return {
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      displayName: row.displayName,
      issuer: row.issuer,
      metadataUrl: row.metadataUrl,
      x509Cert: row.x509Cert,
      ssoUrl: row.ssoUrl,
      sloUrl: row.sloUrl,
      audience: row.audience,
      oidcClientId: row.oidcClientId,
      oidcClientSecretSet: !!row.oidcClientSecretEncrypted,
      oidcScopes: row.oidcScopes,
      attributeMapping: row.attributeMapping,
      defaultRole: row.defaultRole as SsoConnectionDto['defaultRole'],
      enabled: row.enabled,
      acsUrl: urls.acs,
      oidcRedirectUrl: urls.oidcRedirect,
      loginUrl: row.provider === 'saml' ? urls.samlLogin : urls.oidcLogin,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}

// The audit trigger wants an actor; SSO provisioning runs without a human
// actor on the JIT path, so we stamp a stable sentinel user id. It is never
// a real user — it only labels the audit_log actor column.
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
