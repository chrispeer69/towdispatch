import { randomBytes, timingSafeEqual } from 'node:crypto';
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
} from '@ustowdispatch/db';
import {
  type AuthTenantDto,
  type AuthUserDto,
  type AuthenticatedResponse,
  ERROR_CODES,
  type ForgotPasswordPayload,
  type LoginPayload,
  type LoginResponse,
  type MeResponse,
  type MfaChallengePayload,
  type MfaSetupResponse,
  type MfaVerifyEnrollmentPayload,
  ROLES,
  type ResetPasswordPayload,
  type SignupPayload,
  type TenantSelectionDto,
  type VerifyEmailPayload,
  coerceToSupportedLocale,
} from '@ustowdispatch/shared';
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
// MFA challenge / verify-enrollment: 5 failures in 15m → lock 15m. The
// counter is on the user row (mfa_failed_attempts) so a determined
// attacker can't reset it by switching IPs; it clears on the next
// successful MFA verification.
const MFA_MAX_FAILED_ATTEMPTS = 5;
const MFA_LOCKOUT_MINUTES = 15;
const RECOVERY_CODE_COUNT = 10;
// 10 lowercase chars, base32-style alphabet (no 0/1/o/l confusion). We
// display it as two 5-char groups separated by a dash for readability.
const RECOVERY_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

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

  /**
   * Cheap public probe: is `tenantSlug` available, and if not, what's
   * the lowest-numbered free suffix? Returns both pieces so the signup
   * form can show a green check or auto-uniquify in the same render.
   */
  async checkSlugAvailability(
    tenantSlug: string,
  ): Promise<{ available: boolean; suggested: string }> {
    return this.admin.runAsAdmin({}, async (db) => {
      const direct = await db.query.tenants.findFirst({
        where: eq(tenants.slug, tenantSlug),
        columns: { id: true },
      });
      if (!direct) {
        return { available: true, suggested: tenantSlug };
      }
      // Walk -2, -3, ... until we find a free slot. Capped so we don't
      // run away in the (impossible) worst case.
      for (let i = 2; i <= 50; i++) {
        const candidate = `${tenantSlug}-${i}`.slice(0, 40);
        const taken = await db.query.tenants.findFirst({
          where: eq(tenants.slug, candidate),
          columns: { id: true },
        });
        if (!taken) {
          return { available: false, suggested: candidate };
        }
      }
      return {
        available: false,
        suggested: `${tenantSlug}-${Date.now()}`.slice(0, 40),
      };
    });
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

    // MFA on the login path is gated by MFA_LOGIN_GATE_ENABLED (default
    // false). When the flag is off, valid credentials produce tokens
    // immediately — no `mfa_required`, no `mfa_setup_required`. The
    // /auth/mfa/* endpoints remain mounted for future re-enable. Flip
    // MFA_LOGIN_GATE_ENABLED=true to bring back the wall + challenge.
    if (this.config.mfaLoginGateEnabled) {
      if (candidate.user.mfaEnabled) {
        const challengeToken = await this.jwt.signMfaChallenge({
          sub: candidate.user.id,
          tid: candidate.user.tenantId,
          role: candidate.user.role,
        });
        return { status: 'mfa_required', challengeToken };
      }

      // MFA enforcement gate: OWNER and ADMIN cannot ride without MFA. They
      // get a short-lived setup token instead of access tokens; the client
      // must call /auth/mfa/setup + verify-setup to complete enrollment,
      // then re-login.
      if (
        (candidate.user.role === ROLES.OWNER || candidate.user.role === ROLES.ADMIN) &&
        !candidate.user.mfaEnabled
      ) {
        const setupToken = await this.jwt.signMfaSetupRequired({
          sub: candidate.user.id,
          tid: candidate.user.tenantId,
          role: candidate.user.role,
        });
        return { status: 'mfa_setup_required', setupToken, role: candidate.user.role };
      }
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
  // MFA CHALLENGE — called by enrolled users at login time. Accepts either
  // the 6-digit TOTP code from the authenticator app, OR one of the 10
  // single-use recovery codes shown at enrollment. Failed attempts increment
  // mfa_failed_attempts; at MFA_MAX_FAILED_ATTEMPTS the account's MFA path
  // is locked for MFA_LOCKOUT_MINUTES (the password lockout is a separate
  // counter and is unaffected).
  // ===========================================================================
  async mfaChallenge(
    input: MfaChallengePayload,
    meta: AuthRequestMeta,
  ): Promise<AuthenticatedResponse> {
    let claims: Awaited<ReturnType<JwtService['verifyMfaChallenge']>>;
    try {
      claims = await this.jwt.verifyMfaChallenge(input.challengeToken);
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

    if (found.user.mfaLockedUntil && found.user.mfaLockedUntil > new Date()) {
      throw new ForbiddenException({
        code: ERROR_CODES.ACCOUNT_LOCKED,
        message: 'Too many failed MFA attempts. Try again in a few minutes.',
      });
    }

    const accepted = await this.tryMfaCode(found.user, input.code);
    if (!accepted) {
      await this.recordMfaFailure(found.user.id);
      throw new UnauthorizedException({
        code: ERROR_CODES.MFA_INVALID_CODE,
        message: 'Invalid TOTP or recovery code',
      });
    }

    await this.clearMfaFailures(found.user.id);
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
  // MFA ENROLLMENT (token-driven, runs BEFORE the user has a full session)
  //
  // The user just logged in with email + password and the API answered with
  // status=mfa_setup_required + a short-lived setupToken. They are not yet
  // authenticated. /auth/mfa/setup accepts that setupToken and provisions
  // the secret + recovery codes; /auth/mfa/verify accepts the same token
  // plus a TOTP code, marks the user enrolled, and finally hands out
  // access/refresh tokens.
  //
  // This is the only place we mint recovery codes. They are shown to the
  // user exactly once (verify-step displays the panel before letting the
  // user move on), then stored only as sha256 hashes.
  // ===========================================================================
  async mfaSetupWithToken(setupToken: string): Promise<MfaSetupResponse> {
    const claims = await this.verifyMfaSetupTokenOrThrow(setupToken);

    const secret = this.totp.generateSecret();
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);

    const account = await this.admin.runAsAdmin({ actorUserId: claims.sub }, async (db) => {
      const user = await db.query.users.findFirst({
        where: and(eq(users.id, claims.sub), isNull(users.deletedAt)),
      });
      if (!user) {
        throw new UnauthorizedException({
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'User no longer exists',
        });
      }
      if (user.mfaEnabled) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'MFA is already enrolled for this account',
        });
      }
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
      const issuer = `US Tow DISPATCH:${tenant?.slug ?? 'app'}`;
      await db
        .update(users)
        .set({
          totpSecretEncrypted: this.totp.encrypt(secret),
          mfaRecoveryCodes: recoveryCodes.map((c) => hashToken(c)),
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      return { email: user.email, issuer };
    });

    const otpAuthUrl = this.totp.buildOtpAuthUrl({
      account: account.email,
      issuer: account.issuer,
      secret,
    });
    const qrCodeDataUrl = await this.totp.buildQrDataUrl(otpAuthUrl);
    return {
      otpAuthUrl,
      secret,
      qrCodeDataUrl,
      // recoveryCodes are formatted "abcde-12345" for the user; the schema
      // accepts either form (with or without dash) on submission.
      recoveryCodes: recoveryCodes.map(formatRecoveryCode),
    };
  }

  async mfaVerifyEnrollment(
    input: MfaVerifyEnrollmentPayload,
    meta: AuthRequestMeta,
  ): Promise<AuthenticatedResponse> {
    const claims = await this.verifyMfaSetupTokenOrThrow(input.setupToken);

    const result = await this.admin.runAsAdmin({ actorUserId: claims.sub }, async (db) => {
      const user = await db.query.users.findFirst({
        where: and(eq(users.id, claims.sub), isNull(users.deletedAt)),
      });
      if (!user || !user.totpSecretEncrypted) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'No MFA setup in progress. Restart enrollment.',
        });
      }
      if (user.mfaLockedUntil && user.mfaLockedUntil > new Date()) {
        throw new ForbiddenException({
          code: ERROR_CODES.ACCOUNT_LOCKED,
          message: 'Too many failed MFA attempts. Try again in a few minutes.',
        });
      }
      const secret = this.totp.decrypt(user.totpSecretEncrypted);
      if (!this.totp.verify(secret, input.totpCode)) {
        // Inline failure handling — the outer transaction would roll back if
        // we threw, so update via a follow-up runAsAdmin call below instead.
        return { kind: 'invalid' as const };
      }
      const tenant = await db.query.tenants.findFirst({
        where: and(eq(tenants.id, user.tenantId), isNull(tenants.deletedAt)),
      });
      if (!tenant || tenant.status !== 'active') {
        throw new ForbiddenException({
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'Tenant is no longer active',
        });
      }
      const now = new Date();
      await db
        .update(users)
        .set({
          mfaEnabled: true,
          mfaEnrolledAt: now,
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
      return { kind: 'ok' as const, user: { ...user, mfaEnabled: true }, tenant };
    });

    if (result.kind === 'invalid') {
      await this.recordMfaFailure(claims.sub);
      throw new BadRequestException({
        code: ERROR_CODES.MFA_INVALID_CODE,
        message: 'Invalid TOTP code. Try again.',
      });
    }

    const tokens = await this.issueTokens(
      { tenantId: result.user.tenantId, userId: result.user.id, role: result.user.role },
      meta,
      null,
    );
    return {
      status: 'authenticated',
      user: this.toUserDto(result.user),
      tenant: this.toTenantDto(result.tenant),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  private async verifyMfaSetupTokenOrThrow(token: string): Promise<{ sub: string; tid: string }> {
    try {
      const claims = await this.jwt.verifyMfaSetupRequired(token);
      return { sub: claims.sub, tid: claims.tid };
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Setup token is invalid or expired. Sign in again to restart enrollment.',
      });
    }
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
  // ENTERPRISE SSO (Session 38)
  // ===========================================================================
  /**
   * Mint an operator session for a user who authenticated through an external
   * IdP (SAML / OIDC). This reuses the EXACT password-login token path
   * (issueTokens → mintTokensInTransaction), so the access + refresh tokens
   * are the same shape, the same /auth/refresh endpoint accepts them, and
   * there is no second auth realm. The SSO module owns assertion verification
   * + user provisioning and calls in here only to issue the session.
   */
  async issueSsoTokens(
    ctx: { tenantId: string; userId: string; role: string },
    meta: AuthRequestMeta,
  ): Promise<IssuedTokens> {
    return this.issueTokens(ctx, meta, null);
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

  // ---------------------------------------------------------------------------
  // MFA helpers
  // ---------------------------------------------------------------------------

  /**
   * Tries the supplied code against the user's TOTP secret first, then against
   * the recovery-code set. If a recovery code matches, it is consumed (removed
   * from the array) before returning true. Returns false on no match.
   */
  private async tryMfaCode(user: typeof users.$inferSelect, code: string): Promise<boolean> {
    if (!user.totpSecretEncrypted) return false;
    // TOTP: 6 digits, fast path.
    if (/^\d{6}$/.test(code)) {
      const secret = this.totp.decrypt(user.totpSecretEncrypted);
      if (this.totp.verify(secret, code)) return true;
    }
    // Recovery code: compare sha256(normalized) against the stored hash array.
    // Each match consumes the code so it can never be reused.
    const submittedHash = hashToken(code);
    const stored = user.mfaRecoveryCodes ?? [];
    let matched = false;
    const remaining: string[] = [];
    for (const h of stored) {
      if (!matched && constantTimeHexEqual(h, submittedHash)) {
        matched = true;
        continue;
      }
      remaining.push(h);
    }
    if (!matched) return false;
    await this.admin.runAsAdmin({ actorUserId: user.id }, async (db) => {
      await db
        .update(users)
        .set({ mfaRecoveryCodes: remaining, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    });
    return true;
  }

  private async recordMfaFailure(userId: string): Promise<void> {
    await this.admin.runAsAdmin({ actorUserId: userId }, async (db) => {
      const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!u) return;
      const next = (u.mfaFailedAttempts ?? 0) + 1;
      const lockUntil =
        next >= MFA_MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + MFA_LOCKOUT_MINUTES * 60 * 1000)
          : (u.mfaLockedUntil ?? null);
      await db
        .update(users)
        .set({ mfaFailedAttempts: next, mfaLockedUntil: lockUntil, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
  }

  private async clearMfaFailures(userId: string): Promise<void> {
    await this.admin.runAsAdmin({ actorUserId: userId }, async (db) => {
      await db
        .update(users)
        .set({ mfaFailedAttempts: 0, mfaLockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
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

  /**
   * Mint a full session for a user that already exists. Used by the
   * accept-invite flow (UserInvitesController.accept), which has already
   * created the user inside the right tenant context and just needs a
   * signed access/refresh pair + the standard AuthenticatedResponse shape.
   *
   * Deliberately bypasses the MFA gate: receiving the emailed invite token
   * proved ownership, and the invite flow is the canonical way an
   * OWNER/ADMIN onboards new operators — forcing MFA setup here would make
   * the first login impossible until separate enrollment lands.
   */
  async issueSessionForUser(
    input: {
      tenantId: string;
      userId: string;
      role: string;
      tenantName: string;
      tenantSlug: string;
      user: typeof users.$inferSelect;
    },
    meta: AuthRequestMeta,
  ): Promise<AuthenticatedResponse> {
    const tokens = await this.issueTokens(
      { tenantId: input.tenantId, userId: input.userId, role: input.role },
      meta,
      null,
    );
    return {
      status: 'authenticated',
      user: this.toUserDto(input.user),
      tenant: {
        id: input.tenantId,
        slug: input.tenantSlug,
        name: input.tenantName,
        status: 'active',
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
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
      localePreference: u.localePreference ?? null,
    };
  }

  private toTenantDto(t: typeof tenants.$inferSelect): AuthTenantDto {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      // Canada Expansion (S47): localization defaults from the tenant row.
      // defaultLocale is coerced onto a supported locale (the DB only checks
      // BCP-47 format, not membership in the supported set).
      country: t.country,
      defaultLocale: coerceToSupportedLocale(t.defaultLocale) ?? undefined,
      defaultCurrency: t.defaultCurrency,
      defaultUnitSystem: t.defaultUnitSystem,
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

/**
 * Generates `count` recovery codes. Each is 10 lowercase chars drawn from a
 * Crockford-style base32 alphabet (no 0/1/o/l confusion). Returned without
 * dashes — formatting for display happens in formatRecoveryCode.
 */
function generateRecoveryCodes(count: number): string[] {
  const out: string[] = [];
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const seen = new Set<string>();
  while (out.length < count) {
    const buf = randomBytes(10);
    let code = '';
    for (let i = 0; i < 10; i += 1) {
      // Cast forced because TS noUncheckedIndexedAccess flags buf[i] as
      // possibly undefined despite the bounded loop. Buffer indexing is
      // always defined for i < length.
      const b = buf[i] as number;
      code += alphabet[b % alphabet.length];
    }
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function formatRecoveryCode(raw: string): string {
  if (raw.length !== 10) return raw;
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
