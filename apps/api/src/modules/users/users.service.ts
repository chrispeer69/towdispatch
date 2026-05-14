/**
 * UsersService — list/get/create/update/deactivate users in the caller's
 * tenant. Every read and write goes through TenantAwareDb so RLS enforces
 * tenant isolation even if a query forgets to add `WHERE tenant_id = ...`.
 *
 * Soft-delete only (sets deleted_at + is_active=false). Hard delete is an
 * ops-tooling concern and runs through the admin pool.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { users, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateUserPayload,
  ERROR_CODES,
  type Role,
  type UpdateUserPayload,
  type UserDto,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { PasswordService } from '../auth/password.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly password: PasswordService,
  ) {}

  async list(ctx: CallerContext): Promise<UserDto[]> {
    const rows = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.users.findMany({
        where: isNull(users.deletedAt),
        orderBy: (table, { asc }) => [asc(table.createdAt)],
      });
    });
    return rows.map(toDto);
  }

  async get(ctx: CallerContext, userId: string): Promise<UserDto> {
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.users.findFirst({
        where: and(eq(users.id, userId), isNull(users.deletedAt)),
      });
    });
    if (!row) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'User not found',
      });
    }
    return toDto(row);
  }

  async create(ctx: CallerContext, input: CreateUserPayload): Promise<UserDto> {
    const passwordHash = await this.password.hash(input.password);
    const newId = uuidv7();
    const inserted = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conflict = await tx.query.users.findFirst({
        where: and(eq(users.email, input.email), isNull(users.deletedAt)),
      });
      if (conflict) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `A user with email "${input.email}" already exists in this tenant`,
        });
      }
      const [row] = await tx
        .insert(users)
        .values({
          id: newId,
          tenantId: ctx.tenantId,
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          role: (input.role ?? 'dispatcher') as Role,
        })
        .returning();
      if (!row) {
        throw new Error('insert users .. returning() yielded no row');
      }
      return row;
    });
    return toDto(inserted);
  }

  async update(ctx: CallerContext, userId: string, input: UpdateUserPayload): Promise<UserDto> {
    const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.users.findFirst({
        where: and(eq(users.id, userId), isNull(users.deletedAt)),
      });
      if (!existing) return null;

      const patch: Partial<typeof users.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.email !== undefined) patch.email = input.email;
      if (input.firstName !== undefined) patch.firstName = input.firstName;
      if (input.lastName !== undefined) patch.lastName = input.lastName;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.role !== undefined) patch.role = input.role;

      const [row] = await tx.update(users).set(patch).where(eq(users.id, userId)).returning();
      return row;
    });
    if (!updated) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'User not found',
      });
    }
    return toDto(updated);
  }

  async deactivate(ctx: CallerContext, userId: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ id: users.id });
      return Boolean(row);
    });
    if (!ok) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'User not found',
      });
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

function toDto(u: typeof users.$inferSelect): UserDto {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
  };
}
