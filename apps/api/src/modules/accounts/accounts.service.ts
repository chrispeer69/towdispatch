/**
 * AccountsService — list/get/create/update/soft-delete commercial accounts
 * (motor clubs and fleet customers). Soft delete refuses if any active
 * customer still references the account, so we don't orphan billing context.
 *
 * All reads/writes go through TenantAwareDb so RLS enforces isolation even
 * if a query forgets a tenant_id filter.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { accounts, customers, uuidv7 } from '@towcommand/db';
import {
  type AccountDto,
  type AccountFilters,
  type AccountSearchQuery,
  type CreateAccountPayload,
  ERROR_CODES,
  type PaginatedAccounts,
  type UpdateAccountPayload,
} from '@towcommand/shared';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AccountsService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerContext, filters: AccountFilters): Promise<PaginatedAccounts> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(accounts.deletedAt)];
      if (filters.active !== undefined) conds.push(eq(accounts.active, filters.active));
      if (filters.isMotorClub !== undefined)
        conds.push(eq(accounts.isMotorClub, filters.isMotorClub));
      if (filters.q) {
        const pattern = `%${filters.q.toLowerCase()}%`;
        conds.push(sql`lower(${accounts.name}) LIKE ${pattern}`);
      }
      const whereExpr = and(...conds);

      const countRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(accounts)
        .where(whereExpr);
      const total = countRow[0]?.count ?? 0;

      const rows = await tx.query.accounts.findMany({
        where: whereExpr,
        orderBy: (table, { asc }) => [asc(table.name)],
        limit: filters.perPage,
        offset: (filters.page - 1) * filters.perPage,
      });
      return {
        data: rows.map(toDto),
        page: filters.page,
        perPage: filters.perPage,
        total,
      };
    });
  }

  async get(ctx: CallerContext, id: string): Promise<AccountDto> {
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.accounts.findFirst({
        where: and(eq(accounts.id, id), isNull(accounts.deletedAt)),
      });
    });
    if (!row) throw notFound();
    return toDto(row);
  }

  async create(ctx: CallerContext, input: CreateAccountPayload): Promise<AccountDto> {
    const id = uuidv7();
    const inserted = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conflict = await tx.query.accounts.findFirst({
        where: and(eq(accounts.name, input.name), isNull(accounts.deletedAt)),
      });
      if (conflict) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `An account named "${input.name}" already exists`,
        });
      }
      const [row] = await tx
        .insert(accounts)
        .values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          accountNumber: input.accountNumber ?? null,
          billingTerms: input.billingTerms,
          creditLimit: input.creditLimit ?? null,
          billingAddress: input.billingAddress ?? null,
          billingEmail: input.billingEmail ?? null,
          billingPhone: input.billingPhone ?? null,
          apContactName: input.apContactName ?? null,
          apContactEmail: input.apContactEmail ?? null,
          coiRequired: input.coiRequired ?? false,
          coiExpiresAt: input.coiExpiresAt ?? null,
          coiDocumentUrl: input.coiDocumentUrl ?? null,
          isMotorClub: input.isMotorClub ?? false,
          motorClubNetworkCode: input.motorClubNetworkCode ?? null,
          active: input.active ?? true,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('insert accounts .. returning() yielded no row');
      return row;
    });
    return toDto(inserted);
  }

  async update(ctx: CallerContext, id: string, input: UpdateAccountPayload): Promise<AccountDto> {
    const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, id), isNull(accounts.deletedAt)),
      });
      if (!existing) return null;

      const patch: Partial<typeof accounts.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.accountNumber !== undefined) patch.accountNumber = input.accountNumber;
      if (input.billingTerms !== undefined) patch.billingTerms = input.billingTerms;
      if (input.creditLimit !== undefined) patch.creditLimit = input.creditLimit;
      if (input.billingAddress !== undefined) patch.billingAddress = input.billingAddress;
      if (input.billingEmail !== undefined) patch.billingEmail = input.billingEmail;
      if (input.billingPhone !== undefined) patch.billingPhone = input.billingPhone;
      if (input.apContactName !== undefined) patch.apContactName = input.apContactName;
      if (input.apContactEmail !== undefined) patch.apContactEmail = input.apContactEmail;
      if (input.coiRequired !== undefined) patch.coiRequired = input.coiRequired;
      if (input.coiExpiresAt !== undefined) patch.coiExpiresAt = input.coiExpiresAt;
      if (input.coiDocumentUrl !== undefined) patch.coiDocumentUrl = input.coiDocumentUrl;
      if (input.isMotorClub !== undefined) patch.isMotorClub = input.isMotorClub;
      if (input.motorClubNetworkCode !== undefined)
        patch.motorClubNetworkCode = input.motorClubNetworkCode;
      if (input.active !== undefined) patch.active = input.active;
      if (input.notes !== undefined) patch.notes = input.notes;

      const [row] = await tx.update(accounts).set(patch).where(eq(accounts.id, id)).returning();
      return row;
    });
    if (!updated) throw notFound();
    return toDto(updated);
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const result = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, id), isNull(accounts.deletedAt)),
      });
      if (!existing) return { ok: false as const };

      const refRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(eq(customers.accountId, id), isNull(customers.deletedAt)));
      if ((refRow[0]?.count ?? 0) > 0) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message:
            'Cannot delete account: active customers still reference it. Reassign or remove them first.',
        });
      }

      const [row] = await tx
        .update(accounts)
        .set({ deletedAt: new Date(), updatedAt: new Date(), active: false })
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
        .returning({ id: accounts.id });
      return { ok: Boolean(row) };
    });
    if (!result.ok) throw notFound();
  }

  async search(
    ctx: CallerContext,
    query: AccountSearchQuery,
  ): Promise<Array<Pick<AccountDto, 'id' | 'name' | 'isMotorClub' | 'active'>>> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const pattern = `%${query.q.toLowerCase()}%`;
      const rows = await tx
        .select({
          id: accounts.id,
          name: accounts.name,
          isMotorClub: accounts.isMotorClub,
          active: accounts.active,
        })
        .from(accounts)
        .where(
          and(
            isNull(accounts.deletedAt),
            or(
              sql`lower(${accounts.name}) LIKE ${pattern}`,
              sql`lower(coalesce(${accounts.accountNumber}, '')) LIKE ${pattern}`,
            ),
          ),
        )
        .orderBy(accounts.name)
        .limit(query.limit);
      return rows;
    });
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

const notFound = (): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Account not found' });

function toDto(a: typeof accounts.$inferSelect): AccountDto {
  return {
    id: a.id,
    tenantId: a.tenantId,
    name: a.name,
    accountNumber: a.accountNumber,
    billingTerms: a.billingTerms,
    creditLimit: a.creditLimit,
    creditUsed: a.creditUsed,
    billingAddress: (a.billingAddress as AccountDto['billingAddress']) ?? null,
    billingEmail: a.billingEmail,
    billingPhone: a.billingPhone,
    apContactName: a.apContactName,
    apContactEmail: a.apContactEmail,
    coiRequired: a.coiRequired,
    coiExpiresAt: a.coiExpiresAt ? formatDate(a.coiExpiresAt) : null,
    coiDocumentUrl: a.coiDocumentUrl,
    defaultRateSheetId: a.defaultRateSheetId,
    isMotorClub: a.isMotorClub,
    motorClubNetworkCode: a.motorClubNetworkCode,
    active: a.active,
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
    createdBy: a.createdBy,
  };
}

// Postgres `date` returns either a Date or a string from node-postgres
// depending on type-parser settings. Normalize to YYYY-MM-DD.
function formatDate(d: Date | string): string {
  if (typeof d === 'string') return d;
  return d.toISOString().slice(0, 10);
}
