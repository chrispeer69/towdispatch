/**
 * LienholderService — the repossession client book (Repo Workflow Session 49).
 *
 * Tenant-scoped CRUD over `lienholders`. Every method runs inside
 * runInTenantContext so RLS isolates tenants; the controller gates each by
 * Role. Inline data access (no repository.ts) to match the S22 impound pattern.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { lienholders, repoCases, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateLienholderPayload,
  ERROR_CODES,
  type LienholderBillingTerms,
  type LienholderDto,
  type ListLienholdersFilter,
  type UpdateLienholderPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { RepoCallerCtx } from './repo-case.service.js';

@Injectable()
export class LienholderService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: RepoCallerCtx, filter: ListLienholdersFilter): Promise<LienholderDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(lienholders.deletedAt)];
      if (filter.active !== undefined) {
        clauses.push(eq(lienholders.isActive, filter.active === 'true'));
      }
      const rows = await tx.query.lienholders.findMany({
        where: and(...clauses),
        orderBy: (t, { asc }) => [asc(t.name)],
      });
      return rows.map(toLienholderDto);
    });
  }

  async get(ctx: RepoCallerCtx, id: string): Promise<LienholderDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.lienholders.findFirst({
        where: and(eq(lienholders.id, id), isNull(lienholders.deletedAt)),
      });
      if (!row) throw notFound('Lienholder not found');
      return toLienholderDto(row);
    });
  }

  async create(ctx: RepoCallerCtx, input: CreateLienholderPayload): Promise<LienholderDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const id = uuidv7();
      const [row] = await tx
        .insert(lienholders)
        .values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          billingTerms: input.billingTerms ?? null,
          invoiceFormat: input.invoiceFormat ?? 'basic',
          notes: input.notes ?? null,
          isActive: input.isActive ?? true,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('createLienholder: insert returning() yielded no row');
      return toLienholderDto(row);
    });
  }

  async update(
    ctx: RepoCallerCtx,
    id: string,
    input: UpdateLienholderPayload,
  ): Promise<LienholderDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.lienholders.findFirst({
        where: and(eq(lienholders.id, id), isNull(lienholders.deletedAt)),
      });
      if (!existing) throw notFound('Lienholder not found');
      const patch: Partial<typeof lienholders.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.contactName !== undefined) patch.contactName = input.contactName ?? null;
      if (input.phone !== undefined) patch.phone = input.phone ?? null;
      if (input.email !== undefined) patch.email = input.email ?? null;
      if (input.addressLine1 !== undefined) patch.addressLine1 = input.addressLine1 ?? null;
      if (input.addressLine2 !== undefined) patch.addressLine2 = input.addressLine2 ?? null;
      if (input.city !== undefined) patch.city = input.city ?? null;
      if (input.state !== undefined) patch.state = input.state ?? null;
      if (input.postalCode !== undefined) patch.postalCode = input.postalCode ?? null;
      if (input.billingTerms !== undefined) patch.billingTerms = input.billingTerms ?? null;
      if (input.invoiceFormat !== undefined) patch.invoiceFormat = input.invoiceFormat;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      const [row] = await tx
        .update(lienholders)
        .set(patch)
        .where(and(eq(lienholders.id, id), isNull(lienholders.deletedAt)))
        .returning();
      if (!row) throw notFound('Lienholder not found');
      return toLienholderDto(row);
    });
  }

  async softDelete(ctx: RepoCallerCtx, id: string): Promise<void> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.lienholders.findFirst({
        where: and(eq(lienholders.id, id), isNull(lienholders.deletedAt)),
      });
      if (!existing) throw notFound('Lienholder not found');
      // Refuse to delete a lienholder that still has live (non-terminal) cases.
      const liveCase = await tx.query.repoCases.findFirst({
        where: and(eq(repoCases.lienholderId, id), isNull(repoCases.deletedAt)),
        columns: { id: true, status: true },
      });
      if (liveCase && liveCase.status !== 'closed' && liveCase.status !== 'cancelled') {
        throw new ConflictException({
          code: ERROR_CODES.LIENHOLDER_IN_USE,
          message: 'Cannot delete a lienholder with active repo cases.',
        });
      }
      await tx
        .update(lienholders)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(lienholders.id, id));
    });
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message });
}

export function toLienholderDto(row: typeof lienholders.$inferSelect): LienholderDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    billingTerms: (row.billingTerms as LienholderBillingTerms | null) ?? null,
    invoiceFormat: row.invoiceFormat,
    notes: row.notes,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
