import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  emailVerificationTokens,
  passwordResetTokens,
  sessions,
  tenants,
  users,
  uuidv7,
} from '@towcommand/db';
import {
  type AuthTenantDto,
  type AuthUserDto,
  type AuthenticatedResponse,
  ERROR_CODES,
  type ForgotPasswordPayload,
  type LoginPayload,
  type LoginResponse,
  type MeResponse,
  type MfaLoginPayload,
  type MfaSetupResponse,
  type MfaVerifySetupPayload,
  type ResetPasswordPayload,
  type SignupPayload,
  type TenantSelectionDto,
  type VerifyEmailPayload,
} from '@towcommand/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type JWTPayload, SignJWT, jwtVerify } from 'jose';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { EmailService } from '../email/email.service.js';
import { RateLimiterService } from '../redis/rate-limiter.service.js';
import { generatePlainToken, hashToken } from './auth-tokens.util.js';
import { JwtService } from './jwt.service.js';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const VERIFY_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_MINUTES = 60;
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_TTL_SECONDS = 15 * 60;
const FORGOT_RATE_LIMIT = 3;
const FORGOT_RATE_TTL_SECONDS = 60 * 60;
const RESEND_VERIFY_RATE_LIMIT = 3;
const RESEND_VERIFY_RATE_TTL_SECONDS = 60 * 60;

export interface AuthRequestMeta {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | undefined;
}

interface SessionUserContext {
  tenantId: string;
  userId: string;
  role: string;
}

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly refreshKey: Uint8Array;

  constructor(
    private readonly config: ConfigService,
    private readonly tenantDb: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly jwt: JwtService,
    private readonly password: PasswordService,
    private readonly totp: TotpService,
    private readonly email: EmailService,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.refreshKey = new TextEncoder().encode(config.jwt.refreshSecret);
  }

  // ===========================================================================
  // SIGNUP
  // ===========================================================================
  async signup(input: SignupPayload, meta: AuthRequestMeta): Promise<AuthenticatedResponse> {
    const tenantId = uuidv7();
    const userId = uuidv7();
    const { firstName, lastName } = splitName(input.ownerName);
    const passwordHash = await this.password.hash(input.password);

    const verificationPlain = generatePlainToken();
    const verificationHash = hashToken(verificationPlain);
    const verificationExpiry = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    let createdUser: typeof users.$inferSelect | null = null;
    let createdTenant: typeof tenants.$inferSelect | null = null;

    await this.admin.runAsAdmin(
      {
        actorUserId: userId,
        ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      },
      async (db) => {
        const slugTaken = await db.query.tenants.findFirst({
          where: eq(tenants.slug, input.tenantSlug),
        });
        if (slugTaken) {
          throw new ConflictException({
            code: ERROR_CODES.CONFLICT,
            message: `Tenant slug "${input.tenantSlug}" is already taken`,
          });
        }

        const [tenant] = await db
          .insert(tenants)
          .values({
            id: tenantId,
            slug: input.tenantSlug,
            name: input.tenantName,
            status: 'active',
          })
          .returning();
        createdTenant = tenant ?? null;

        const [user] = await db
          .insert(users)
          .values({
            id: userId,
            tenantId,
            email: input.ownerEmail,
            passwordHash,
            firstName,
            lastName,
            role: 'owner',
          })
          .returning();
        createdUser = user ?? null;

        await db.insert(emailVerificationTokens).values({
          id: uuidv7(),
          tenantId,
          userId,
          tokenHash: verificationHash,
          expiresAt: verificationExpiry,
        });
      },
    );

    if (!createdTenant || !createdUser) {
      throw new Error('signup: row insertion did not return a row');
    }

    // Fire-and-forget — failures are surfaced via "Resend verification".
    void this.email
      .sendVerificationEmail({
        to: input.ownerEmail,
        name: firstName,
        tenantName: input.tenantName,
        token: verificationPlain,
      })
      .catch(() => undefined);

    const tokens = await this.issueTokens({ tenantId, userId, role: 'owner' }, meta, null);
    return {
      status: 'authenticated',
      user: this.toUserDto(createdUser),
      tenant: this.toTenantDto(createdTenant),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  // ===========================================================================
  // LOGIN
  // ===========================================================================
  async login(input: LoginPayload, meta: AuthRequestMeta): Promise<LoginResponse> {
    const rateKey = `login:${input.email.toLowerCase()}`;
    const rate = await this.rateLimiter.check(rateKey, LOGIN_RATE_LIMIT, LOGIN_RATE_TTL_SECONDS);
    if (!rate.allowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.RATE_LIMITED,
        message: `Too many login attempts. Try again in ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.`,
      });
    }

    // Find user(s) matching email (and slug if provided).
    const candidates = await this.admin.runAsAdmin({}, async (db) => {
      if (input.tenantSlug) {
        const tenant = await db.query.tenants.findFirst({
          where: and(eq(tenants.slug, input.tenantSlug), isNull(tenants.deletedAt)),
        });
        if (!tenant) return [];
        const user = await db.query.users.findFirst({
          where: and(
            eq(users.tenantId, tenant.id),
            eq(users.email, input.email),
            isNull(users.deletedAt),
          ),
        });
        return user ? [{ user, tenant }] : [];
      }
      const userRows = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
      const out: Array<{ user: typeof users.$inferSelect; tenant: typeof tenants.$inferSelect }> =
        [];
      for (const u of userRows) {
        const tenant = await db.query.tenants.findFirst({
          where: and(eq(tenants.id, u.tenantId), isNull(tenants.deletedAt)),
        });
        if (tenant && tenant.status === 'active') out.push({ user: u, tenant });
      }
      return out;
    });

    if (candidates.length === 0) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    if (candidates.length > 1) {
      const tenantList: TenantSelectionDto[] = candidates.map((c) => ({
        slug: c.tenant.slug,
        name: c.tenant.name,
      }));
      return { status: 'needs_tenant_selection', tenants: tenantList };
    }

    const candidate = candidates[0];
    if (!candidate) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    if (!candidate.user.isActive) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    if (candidate.user.lockedUntil && candidate.user.lockedUntil > new Date()) {
      throw new ForbiddenException({
        code: ERROR_CODES.ACCOUNT_LOCKED,
        message: 'Account locked due to repeated failed logins. Try again later.',
      });
    }

    const ok = await this.password.verify(candidate.user.passwordHash, input.password);
    if (!ok) {
      await this.recordFailedLogin(candidate.user.id, candidate.user.tenantId, meta);
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    await this.rateLimiter.reset(rateKey);
    await this.admin.runAsAdmin({ actorUserId: candidate.user.id }, async (db) => {
      await db
        .update(users)
        .set({
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, candidate.user.id));
    });

    if (candidate.user.mfaEnabled) {
      const mfaToken = await this.jwt.signMfaChallenge({
        sub: candidate.user.id,
        tid: candidate.user.tenantId,
        role: candidate.user.role,
      });
      return { status: 'mfa_required', mfaToken };
    }

    const tokens = await this.issueTokens(
      {
        tenantId: candidate.user.tenantId,
        userId: candidate.user.id,
        role: candidate.user.role,
      },
      meta,
      null,
    );
    return {
      status: 'authenticated',
      user: this.toUserDto(candidate.user),
      tenant: this.toTenantDto(candidate.tenant),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  // ===========================================================================
  // MFA LOGIN
  // ===========================================================================
  async mfaLogin(input: MfaLoginPayload, meta: AuthRequestMeta): Promise<AuthenticatedResponse> {
    let claims: Awaited<ReturnType<JwtService['verifyMfaChallenge']>>;
    try {
      claims = await this.jwt.verifyMfaChallenge(input.mfaToken);
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Invalid or expired MFA challenge',
      });
    }

    const found = await this.admin.runAsAdmin({}, async (db) => {
      const user = await db.query.users.findFirst({
        where: and(eq(users.id, claims.sub), isNull(users.deletedAt)),
      });
      if (!user) return null;
      const tenant = await db.query.tenants.findFirst({
        where: and(eq(tenants.id, user.tenantId), isNull(tenants.deletedAt)),
      });
      if (!tenant || tenant.status !== 'active') return null;
      return { user, tenant };
    });

    if (!found || !found.user.mfaEnabled || !found.user.totpSecretEncrypted) {
      throw new UnauthorizedException({
        code: ERROR_CODES.MFA_INVALID_CODE,
        message: 'MFA challenge no longer valid',
      });
    }

    const secret = this.totp.decrypt(found.user.totpSecretEncrypted);
    if (!this.totp.verify(secret, input.totpCode)) {
      throw new UnauthorizedException({
        code: ERROR_CODES.MFA_INVALID_CODE,
        message: 'Invalid TOTP code',
      });
    }

    const tokens = await this.issueTokens(
      {
        tenantId: found.user.tenantId,
        userId: found.user.id,
        role: found.user.role,
      },
      meta,
      null,
    );
    return {
      status: 'authenticated',
      user: this.toUserDto(found.user),
      tenant: this.toTenantDto(found.tenant),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  // ===========================================================================
  // REFRESH (with theft detection)
  // ===========================================================================
  async refresh(refreshToken: string, meta: AuthRequestMeta): Promise<IssuedTokens> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(refreshToken, this.refreshKey, {
        issuer: this.config.jwt.issuer,
        audience: `${this.config.jwt.audience}-refresh`,
        algorithms: ['HS256'],
      });
      payload = result.payload;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Invalid or expired refresh token',
      });
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const tid = typeof payload.tid === 'string' ? payload.tid : null;
    const jti = typeof payload.jti === 'string' ? payload.jti : null;
    const role = typeof payload.role === 'string' ? payload.role : null;
    if (!sub || !tid || !jti || !role) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Refresh token missing required claims',
      });
    }
    const jtiHash = hashToken(jti);

    // Step 1: validate the refresh token. Theft detection has to commit its
    // revoke ON ITS OWN — if we throw inside runAsAdmin the tx rolls back and
    // the revocation is lost. So we use a small "outcome" object instead.
    type RefreshOutcome =
      | { kind: 'mint'; sessionId: string; user: typeof users.$inferSelect }
      | { kind: 'theft' }
      | { kind: 'invalid'; code: string; message: string };

    const outcome: RefreshOutcome = await this.admin.runAsAdmin(
      {
        actorUserId: sub,
        ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      },
      async (db) => {
        const session = await db.query.sessions.findFirst({
          where: and(eq(sessions.refreshTokenHash, jtiHash), eq(sessions.userId, sub)),
        });
        if (!session) {
          return {
            kind: 'invalid',
            code: ERROR_CODES.TOKEN_INVALID,
            message: 'Refresh token not recognized',
          };
        }
        if (session.revokedAt) {
          // Token reuse — revoke every active session for this user, here, in
          // the same tx, then signal theft to the outer caller. The throw
          // happens AFTER the tx commits.
          await db
            .update(sessions)
            .set({ revokedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(sessions.userId, sub), isNull(sessions.revokedAt)));
          return { kind: 'theft' };
        }
        if (session.expiresAt <= new Date()) {
          return {
            kind: 'invalid',
            code: ERROR_CODES.TOKEN_EXPIRED,
            message: 'Refresh token expired',
          };
        }
        const user = await db.query.users.findFirst({ where: eq(users.id, sub) });
        if (!user || !user.isActive) {
          return {
            kind: 'invalid',
            code: ERROR_CODES.UNAUTHORIZED,
            message: 'User no longer active',
          };
        }
        await db
          .update(sessions)
          .set({ revokedAt: new Date(), lastUsedAt: new Date(), updatedAt: new Date() })
          .where(eq(sessions.id, session.id));
        return { kind: 'mint', sessionId: session.id, user };
      },
    );

    if (outcome.kind === 'theft') {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_REUSED,
        message: 'Refresh token reuse detected; all sessions revoked',
      });
    }
    if (outcome.kind === 'invalid') {
      throw new UnauthorizedException({ code: outcome.code, message: outcome.message });
    }

    return this.tenantDb.runInTenantContext(
      {
        tenantId: tid,
        userId: sub,
        ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      },
      (db) =>
        this.mintTokensInTransaction(
          db,
          { tenantId: tid, userId: sub, role },
          meta,
          outcome.sessionId,
        ),
    );
  }

  // ===========================================================================
  // LOGOUT
  // ===========================================================================
  async logout(
    refreshToken: string | undefined,
    ctx: SessionUserContext,
    meta: AuthRequestMeta,
  ): Promise<void> {
    if (!refreshToken) {
      // logout-all: kill every active session for this user.
      await this.tenantDb.runInTenantContext(
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
          ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
          ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        },
        async (db) => {
          await db
            .update(sessions)
            .set({ revokedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(sessions.userId, ctx.userId), isNull(sessions.revokedAt)));
        },
      );
      return;
    }

    let jti: string | null = null;
    try {
      const { payload } = await jwtVerify(refreshToken, this.refreshKey, {
        issuer: this.config.jwt.issuer,
        audience: `${this.config.jwt.audience}-refresh`,
        algorithms: ['HS256'],
      });
      jti = typeof payload.jti === 'string' ? payload.jti : null;
    } catch {
      // Invalid token — nothing to revoke. Swallow; logout is idempotent.
      return;
    }
    if (!jti) return;
    const jtiHash = hashToken(jti);
    await this.tenantDb.runInTenantContext(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      },
      async (db) => {
        await db
          .update(sessions)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(sessions.refreshTokenHash, jtiHash),
              eq(sessions.userId, ctx.userId),
              isNull(sessions.revokedAt),
            ),
          );
      },
    );
  }

  // ===========================================================================
  // FORGOT / RESET PASSWORD
  // ===========================================================================
  async forgotPassword(input: ForgotPasswordPayload): Promise<void> {
    const rateKey = `forgot:${input.email.toLowerCase()}`;
    const rate = await this.rateLimiter.check(rateKey, FORGOT_RATE_LIMIT, FORGOT_RATE_TTL_SECONDS);
    // We DON'T 429 the user — silent rate-limit avoids leaking that an account
    // exists. We just stop sending email past the limit.
    if (!rate.allowed) return;

    const matches = await this.admin.runAsAdmin({}, async (db) => {
      return db.query.users.findMany({
        where: and(eq(users.email, input.email), isNull(users.deletedAt)),
      });
    });

    for (const user of matches) {
      const plain = generatePlainToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
      await this.admin.runAsAdmin({ actorUserId: user.id }, async (db) => {
        await db.insert(passwordResetTokens).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashToken(plain),
          expiresAt,
        });
      });
      void this.email
        .sendPasswordResetEmail({
          to: user.email,
          name: user.firstName,
          token: plain,
        })
        .catch(() => undefined);
    }
  }

  async resetPassword(input: ResetPasswordPayload): Promise<void> {
    const tokenHash = hashToken(input.token);
    const newHash = await this.password.hash(input.newPassword);

    const updated = await this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.passwordResetTokens.findFirst({
        where: and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      });
      if (!row) return null;
      const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      if (!user) return null;

      await db
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));

      await db
        .update(users)
        .set({
          passwordHash: newHash,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Revoke every active session — password change is a security event.
      await db
        .update(sessions)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));

      return user;
    });

    if (!updated) {
      throw new BadRequestException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Reset token is invalid or expired',
      });
    }

    void this.email
      .sendPasswordChangedNotification({ to: updated.email, name: updated.firstName })
      .catch(() => undefined);
  }

  // ===========================================================================
  // EMAIL VERIFICATION
  // ===========================================================================
  async verifyEmail(input: VerifyEmailPayload): Promise<void> {
    const tokenHash = hashToken(input.token);
    const verified = await this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.emailVerificationTokens.findFirst({
        where: and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.consumedAt),
          gt(emailVerificationTokens.expiresAt, new Date()),
        ),
      });
      if (!row) return null;
      const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      if (!user) return null;

      await db
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id));

      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
      return { user, tenant };
    });

    if (!verified || !verified.tenant) {
      throw new BadRequestException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Verification token is invalid or expired',
      });
    }

    void this.email
      .sendWelcomeEmail({
        to: verified.user.email,
        name: verified.user.firstName,
        tenantName: verified.tenant.name,
      })
      .catch(() => undefined);
  }

  async resendVerification(ctx: SessionUserContext, meta: AuthRequestMeta): Promise<void> {
    const rate = await this.rateLimiter.check(
      `resend-verify:${ctx.userId}`,
      RESEND_VERIFY_RATE_LIMIT,
      RESEND_VERIFY_RATE_TTL_SECONDS,
    );
    if (!rate.allowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many verification emails. Try again later.',
      });
    }

    const sent = await this.admin.runAsAdmin({ actorUserId: ctx.userId }, async (db) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      if (!user || user.emailVerifiedAt) return null;
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
      if (!tenant) return null;

      const plain = generatePlainToken();
      const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000);
      await db.insert(emailVerificationTokens).values({
        id: uuidv7(),
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: hashToken(plain),
        expiresAt,
      });
      return { user, tenant, plain };
    });

    if (!sent) return;
    await this.email.sendVerificationEmail({
      to: sent.user.email,
      name: sent.user.firstName,
      tenantName: sent.tenant.name,
      token: sent.plain,
    });
  }

  // ===========================================================================
  // /auth/me
  // ===========================================================================
  async me(ctx: SessionUserContext): Promise<MeResponse> {
    const found = await this.admin.runAsAdmin({}, async (db) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      if (!user) return null;
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
      if (!tenant) return null;
      return { user, tenant };
    });
    if (!found) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'User not found',
      });
    }
    return {
      user: this.toUserDto(found.user),
      tenant: this.toTenantDto(found.tenant),
      permissions: permissionsForRole(found.user.role),
    };
  }

  // ===========================================================================
  // MFA SETUP
  // ===========================================================================
  async mfaSetup(ctx: SessionUserContext): Promise<MfaSetupResponse> {
    const secret = this.totp.generateSecret();
    const account = await this.admin.runAsAdmin({}, async (db) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      if (!user) {
        throw new UnauthorizedException({
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'User not found',
        });
      }
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
      const issuer = `TowCommand:${tenant?.slug ?? 'app'}`;
      // Stash the secret encrypted so verify-setup can confirm the code came
      // from the same provisioning. mfa_enabled stays false until verify-setup.
      await db
        .update(users)
        .set({ totpSecretEncrypted: this.totp.encrypt(secret), updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return { email: user.email, issuer };
    });

    const otpAuthUrl = this.totp.buildOtpAuthUrl({
      account: account.email,
      issuer: account.issuer,
      secret,
    });
    return { otpAuthUrl, secret };
  }

  async mfaVerifySetup(
    ctx: SessionUserContext,
    input: MfaVerifySetupPayload,
  ): Promise<{ enabled: true }> {
    return this.admin.runAsAdmin({ actorUserId: ctx.userId }, async (db) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      if (!user || !user.totpSecretEncrypted) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'No MFA setup in progress',
        });
      }
      const secret = this.totp.decrypt(user.totpSecretEncrypted);
      if (!this.totp.verify(secret, input.totpCode)) {
        throw new BadRequestException({
          code: ERROR_CODES.MFA_INVALID_CODE,
          message: 'Invalid TOTP code',
        });
      }
      await db
        .update(users)
        .set({ mfaEnabled: true, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return { enabled: true };
    });
  }

  async mfaDisable(ctx: SessionUserContext, plainPassword: string): Promise<{ enabled: false }> {
    return this.admin.runAsAdmin({ actorUserId: ctx.userId }, async (db) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      if (!user) {
        throw new UnauthorizedException({
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'User not found',
        });
      }
      const ok = await this.password.verify(user.passwordHash, plainPassword);
      if (!ok) {
        throw new UnauthorizedException({
          code: ERROR_CODES.INVALID_CREDENTIALS,
          message: 'Password does not match',
        });
      }
      await db
        .update(users)
        .set({ mfaEnabled: false, totpSecretEncrypted: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return { enabled: false };
    });
  }

  // ===========================================================================
  // INTERNALS
  // ===========================================================================
  private async issueTokens(
    ctx: SessionUserContext,
    meta: AuthRequestMeta,
    rotatedFromId: string | null,
  ): Promise<IssuedTokens> {
    return this.tenantDb.runInTenantContext(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        ...(meta.requestId !== undefined ? { requestId: meta.requestId } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      },
      (db) => this.mintTokensInTransaction(db, ctx, meta, rotatedFromId),
    );
  }

  private async mintTokensInTransaction(
    db: Tx,
    ctx: SessionUserContext,
    meta: AuthRequestMeta,
    rotatedFromId: string | null,
  ): Promise<IssuedTokens> {
    const sessionId = uuidv7();
    const accessJti = uuidv7();
    const refreshJti = uuidv7();
    const refreshHash = hashToken(refreshJti);
    const refreshTtlSeconds = this.jwt.refreshTtlSeconds();
    const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

    const refreshToken = await new SignJWT({
      sub: ctx.userId,
      tid: ctx.tenantId,
      role: ctx.role,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setJti(refreshJti)
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(`${this.config.jwt.audience}-refresh`)
      .setExpirationTime(this.config.jwt.refreshTtl)
      .sign(this.refreshKey);

    await db.insert(sessions).values({
      id: sessionId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      refreshTokenHash: refreshHash,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt,
      lastUsedAt: new Date(),
      rotatedFromId,
    });

    const accessToken = await this.jwt.signAccess({
      sub: ctx.userId,
      tid: ctx.tenantId,
      role: ctx.role,
      jti: accessJti,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwt.accessTtlSeconds(),
    };
  }

  private async recordFailedLogin(
    userId: string,
    _tenantId: string,
    _meta: AuthRequestMeta,
  ): Promise<void> {
    await this.admin.runAsAdmin({ actorUserId: userId }, async (db) => {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) return;
      const next = (user.failedLoginCount ?? 0) + 1;
      const lockUntil =
        next >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
      await db
        .update(users)
        .set({
          failedLoginCount: next,
          lockedUntil: lockUntil ?? user.lockedUntil ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    });
  }

  private toUserDto(u: typeof users.$inferSelect): AuthUserDto {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
      mfaEnabled: u.mfaEnabled ?? false,
    };
  }

  private toTenantDto(t: typeof tenants.$inferSelect): AuthTenantDto {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
    };
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? '', lastName: '' };
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}

function permissionsForRole(role: string): string[] {
  // Foundation permission set. Real RBAC ships in a later session.
  switch (role) {
    case 'owner':
    case 'admin':
      return [
        'tenant:read',
        'tenant:write',
        'users:read',
        'users:write',
        'jobs:read',
        'jobs:write',
        'drivers:read',
        'drivers:write',
        'invoices:read',
        'invoices:write',
        'integrations:read',
        'integrations:write',
        'settings:read',
        'settings:write',
      ];
    case 'manager':
      return [
        'tenant:read',
        'users:read',
        'jobs:read',
        'jobs:write',
        'drivers:read',
        'drivers:write',
        'invoices:read',
      ];
    case 'dispatcher':
      return ['tenant:read', 'jobs:read', 'jobs:write', 'drivers:read'];
    case 'driver':
      return ['tenant:read', 'jobs:read'];
    case 'accounting':
      return ['tenant:read', 'invoices:read', 'invoices:write'];
    case 'auditor':
      return ['tenant:read', 'jobs:read', 'invoices:read'];
    default:
      return ['tenant:read'];
  }
}

// Drizzle exports `sql` here only so importers don't tree-shake-strip it.
void sql;
