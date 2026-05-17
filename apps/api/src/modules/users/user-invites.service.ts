/**
 * UserInvitesService — invite-by-email onboarding.
 *
 * Replaces the legacy POST /users (admin-set-password) path for production
 * user onboarding. The flow:
 *
 *   1. invite(): OWNER/ADMIN creates a row in user_invites. A random plain
 *      token is generated, sha256-hashed, and stored as token_hash. The
 *      plain value is included ONLY in the outbound email — never in the
 *      response payload — so an admin browsing the invites list cannot
 *      impersonate a recipient.
 *   2. resend(): regenerates the token, extends expires_at by 7 days, and
 *      re-sends the email. Previously-issued tokens become unusable.
 *   3. cancel(): hard-deletes the pending invite. We do not maintain a
 *      "cancelled" status — the row is just gone, which is simpler and
 *      matches the unique partial index "one pending invite per email".
 *   4. list(): returns pending (and optionally consumed/expired) invites
 *      for the caller's tenant. Status is computed at read time from
 *      consumed_at + expires_at.
 *   5. acceptByToken(): PUBLIC entry point — no tenant context yet, so
 *      the lookup happens via fn_lookup_invite_by_token (SECURITY DEFINER,
 *      bypasses RLS for that single SELECT). The resolved tenant_id is
 *      then used to run the rest of the work inside a normal tenant
 *      context: insert the user, mark the invite consumed, return the new
 *      user along with the tenant + invited_by name for downstream auth.
 *
 * Yard scoping: yard_ids is accepted and stored as-is. Validation that
 * "manager/dispatcher/driver must have yard_ids" is deliberately deferred
 * because no yards table exists yet (build 7 spec, Option B). When yards
 * land, the validation gate goes here.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { tenants, userInvites, users, uuidv7 } from '@ustowdispatch/db';
import {
  type AcceptInvitePayload,
  type CreateInvitePayload,
  ERROR_CODES,
  type PublicInvitePreview,
  type Role,
  type UserInviteDto,
  inviteStatusValues,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ADMIN_POOL } from '../../database/database.tokens.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { generatePlainToken, hashToken } from '../auth/auth-tokens.util.js';
import { PasswordService } from '../auth/password.service.js';
import { EmailService } from '../email/email.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  accounting: 'Accounting',
  auditor: 'Auditor',
};

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface InviteListFilter {
  status?: 'pending' | 'expired' | 'all';
}

interface RawInviteLookupRow {
  invite_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  email: string;
  role: Role;
  yard_ids: string[] | null;
  full_name: string | null;
  invited_by: string;
  inviter_name: string | null;
  expires_at: Date;
  consumed_at: Date | null;
}

export interface AcceptInviteOutcome {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  user: typeof users.$inferSelect;
  role: Role;
}

@Injectable()
export class UserInvitesService {
  private readonly log = new Logger(UserInvitesService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    @Inject(ADMIN_POOL) private readonly adminPool: Pool,
    private readonly email: EmailService,
    private readonly password: PasswordService,
  ) {}

  // -------------------------------------------------------------------------
  // invite
  // -------------------------------------------------------------------------
  async invite(ctx: CallerContext, input: CreateInvitePayload): Promise<UserInviteDto> {
    const plainToken = generatePlainToken();
    const tokenHash = hashToken(plainToken);
    const inviteId = uuidv7();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const result = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // 1. Reject if the email already belongs to an active user in this tenant.
      const existingUser = await tx.query.users.findFirst({
        where: and(eq(users.email, input.email), isNull(users.deletedAt)),
      });
      if (existingUser) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `A user with email "${input.email}" already exists in this tenant`,
        });
      }

      // 2. Insert. The DB unique partial index enforces "one pending per
      //    email" — translate its violation into a 409.
      let row: typeof userInvites.$inferSelect | undefined;
      try {
        [row] = await tx
          .insert(userInvites)
          .values({
            id: inviteId,
            tenantId: ctx.tenantId,
            email: input.email,
            role: input.role,
            yardIds: input.yardIds ?? null,
            fullName: input.fullName ?? null,
            invitedBy: ctx.userId,
            tokenHash,
            expiresAt,
          })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: ERROR_CODES.CONFLICT,
            message: 'A pending invite already exists for this email',
          });
        }
        throw err;
      }
      if (!row) throw new Error('insert user_invites returned no row');

      // 3. Resolve inviter + tenant for the email content. Both are tenant-
      //    scoped reads, so they're inside the same tenant transaction.
      const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      const inviter = await tx.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      return { row, tenant, inviter };
    });

    // 4. Send email outside the tenant transaction — slow IO must not block
    //    the row commit. Same pattern as AuthService.signup.
    if (result.tenant && result.inviter) {
      const inviterName = `${result.inviter.firstName} ${result.inviter.lastName}`.trim();
      try {
        await this.email.sendUserInviteEmail({
          to: input.email,
          inviterName: inviterName || result.inviter.email,
          tenantName: result.tenant.name,
          roleLabel: ROLE_LABELS[input.role],
          token: plainToken,
        });
      } catch (err) {
        // Best-effort. The invite row exists, the admin can resend.
        this.log.warn({
          msg: 'invite email send failed',
          inviteId,
          email: input.email,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return toDto(result.row, result.inviter);
  }

  // -------------------------------------------------------------------------
  // resend
  // -------------------------------------------------------------------------
  async resend(ctx: CallerContext, inviteId: string): Promise<UserInviteDto> {
    const plainToken = generatePlainToken();
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const result = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.userInvites.findFirst({
        where: eq(userInvites.id, inviteId),
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invite not found',
        });
      }
      if (existing.consumedAt) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invite has already been accepted',
        });
      }
      const [row] = await tx
        .update(userInvites)
        .set({ tokenHash, expiresAt, updatedAt: new Date() })
        .where(eq(userInvites.id, inviteId))
        .returning();
      if (!row) throw new Error('update user_invites returned no row');
      const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      const inviter = await tx.query.users.findFirst({ where: eq(users.id, ctx.userId) });
      return { row, tenant, inviter };
    });

    if (result.tenant && result.inviter) {
      const inviterName = `${result.inviter.firstName} ${result.inviter.lastName}`.trim();
      try {
        await this.email.sendUserInviteEmail({
          to: result.row.email,
          inviterName: inviterName || result.inviter.email,
          tenantName: result.tenant.name,
          roleLabel: ROLE_LABELS[result.row.role],
          token: plainToken,
        });
      } catch (err) {
        this.log.warn({
          msg: 'invite resend email failed',
          inviteId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return toDto(result.row, result.inviter);
  }

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------
  async cancel(ctx: CallerContext, inviteId: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.userInvites.findFirst({
        where: eq(userInvites.id, inviteId),
      });
      if (!existing) return false;
      if (existing.consumedAt) {
        // Don't delete consumed invites — they're audit trail. 409 is the
        // cleanest signal that the request is no longer meaningful.
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'Cannot cancel an invite that has already been accepted',
        });
      }
      await tx.delete(userInvites).where(eq(userInvites.id, inviteId));
      return true;
    });
    if (!ok) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Invite not found',
      });
    }
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  async list(ctx: CallerContext, filter: InviteListFilter): Promise<UserInviteDto[]> {
    const status = filter.status ?? 'pending';
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const baseWhere =
        status === 'pending'
          ? isNull(userInvites.consumedAt)
          : status === 'expired'
            ? isNull(userInvites.consumedAt)
            : undefined;
      const rows = await tx.query.userInvites.findMany({
        ...(baseWhere ? { where: baseWhere } : {}),
        orderBy: [desc(userInvites.createdAt)],
      });
      const inviters = new Map<string, typeof users.$inferSelect>();
      for (const r of rows) {
        if (!inviters.has(r.invitedBy)) {
          const inviter = await tx.query.users.findFirst({ where: eq(users.id, r.invitedBy) });
          if (inviter) inviters.set(r.invitedBy, inviter);
        }
      }
      const mapped = rows.map((r) => toDto(r, inviters.get(r.invitedBy)));
      // If the caller asked specifically for expired, filter again on the
      // computed status (we couldn't do this purely in SQL without extra
      // expressions, and the row volume here is small).
      if (status === 'expired') return mapped.filter((m) => m.status === 'expired');
      return mapped;
    });
  }

  // -------------------------------------------------------------------------
  // peek (public — accept-invite preview)
  // -------------------------------------------------------------------------
  async previewByToken(plainToken: string): Promise<PublicInvitePreview> {
    const row = await this.lookupByToken(plainToken);
    if (!row) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Invite not found',
      });
    }
    return {
      email: row.email,
      role: row.role,
      fullName: row.full_name,
      tenantName: row.tenant_name,
      inviterName: row.inviter_name,
      status: computeStatus(row.expires_at, row.consumed_at),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // accept (public)
  // -------------------------------------------------------------------------
  async acceptByToken(
    input: AcceptInvitePayload,
    meta: { ipAddress: string | null; userAgent: string | null; requestId: string },
  ): Promise<AcceptInviteOutcome> {
    const row = await this.lookupByToken(input.token);
    if (!row) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Invite not found',
      });
    }
    if (row.consumed_at) {
      throw new GoneException({
        code: ERROR_CODES.CONFLICT,
        message: 'This invitation has already been accepted',
      });
    }
    if (row.expires_at <= new Date()) {
      throw new GoneException({
        code: ERROR_CODES.TOKEN_EXPIRED,
        message: 'This invitation has expired',
      });
    }

    const passwordHash = await this.password.hash(input.password);
    const newUserId = uuidv7();
    const tokenHash = hashToken(input.token);

    // Consume the invite + create the user inside the resolved tenant
    // context. We can use runInTenantContext here because we now know the
    // tenant_id — the SECURITY DEFINER lookup is the bridge from "no
    // session" to "tenant context established".
    const newUser = await this.db.runInTenantContext(
      {
        tenantId: row.tenant_id,
        userId: newUserId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      },
      async (tx) => {
        // Re-fetch invite under RLS so a concurrent consume race fails
        // safely. consumedAt is still null per our earlier lookup, but the
        // update is conditional on that being true now too.
        const upd = await tx
          .update(userInvites)
          .set({ consumedAt: new Date() })
          .where(and(eq(userInvites.tokenHash, tokenHash), isNull(userInvites.consumedAt)))
          .returning({ id: userInvites.id });
        if (upd.length === 0) {
          throw new GoneException({
            code: ERROR_CODES.CONFLICT,
            message: 'This invitation has already been accepted',
          });
        }

        // Email uniqueness inside tenant — if someone signed up
        // independently between the email being sent and this accept,
        // surface as 409.
        const conflict = await tx.query.users.findFirst({
          where: and(eq(users.email, row.email), isNull(users.deletedAt)),
        });
        if (conflict) {
          throw new ConflictException({
            code: ERROR_CODES.CONFLICT,
            message: `A user with email "${row.email}" already exists in this tenant`,
          });
        }

        const { firstName, lastName } = splitName(input.fullName);
        const [created] = await tx
          .insert(users)
          .values({
            id: newUserId,
            tenantId: row.tenant_id,
            email: row.email,
            passwordHash,
            firstName,
            lastName,
            role: row.role,
            yardIds: row.yard_ids ?? null,
            // Receiving the emailed token is the only way to reach this
            // path, so the email is verified by definition.
            emailVerifiedAt: new Date(),
          })
          .returning();
        if (!created) throw new Error('insert users returned no row');
        return created;
      },
    );

    return {
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantSlug: row.tenant_slug,
      user: newUser,
      role: row.role,
    };
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------
  /**
   * Looks up an invite by its plain token, going through the SECURITY
   * DEFINER function so RLS doesn't hide the row from the unauthenticated
   * caller. Returns the joined invite + tenant + inviter slice. Used by
   * both previewByToken (preview page) and acceptByToken (form submit).
   */
  private async lookupByToken(plainToken: string): Promise<RawInviteLookupRow | null> {
    const tokenHash = hashToken(plainToken);
    const client = await this.adminPool.connect();
    try {
      const res = await client.query<RawInviteLookupRow>(
        'SELECT * FROM fn_lookup_invite_by_token($1)',
        [tokenHash],
      );
      return res.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
  );
}

function computeStatus(
  expiresAt: Date,
  consumedAt: Date | null,
): (typeof inviteStatusValues)[number] {
  if (consumedAt) return 'consumed';
  if (expiresAt <= new Date()) return 'expired';
  return 'pending';
}

function toDto(
  r: typeof userInvites.$inferSelect,
  inviter?: typeof users.$inferSelect,
): UserInviteDto {
  const inviterName = inviter
    ? `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email
    : null;
  return {
    id: r.id,
    tenantId: r.tenantId,
    email: r.email,
    role: r.role,
    yardIds: r.yardIds ?? null,
    fullName: r.fullName ?? null,
    invitedBy: r.invitedBy,
    inviterName,
    status: computeStatus(r.expiresAt, r.consumedAt),
    expiresAt: r.expiresAt.toISOString(),
    consumedAt: r.consumedAt ? r.consumedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1),
  };
}

// 'unused' helper prevents `isNotNull` from being tree-shaken from imports
// if no current usage references it explicitly — left in place for future
// "show consumed" filters.
void isNotNull;
