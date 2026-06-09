/**
 * TenantsService — read/update for the caller's own tenant only.
 *
 * Tenant creation lives in AuthService.signup, not here, because creating a
 * tenant has no caller-tenant context yet (chicken/egg). Direct tenant
 * creation by a customer is intentionally not exposed.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { tenants } from '@towdispatch/db';
import { ERROR_CODES, type TenantDto } from '@towdispatch/shared';
import { eq } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface UpdateTenantInput {
  name?: string | undefined;
  settings?: Record<string, unknown> | undefined;
}

@Injectable()
export class TenantsService {
  constructor(private readonly db: TenantAwareDb) {}

  async getCurrent(ctx: CallerContext): Promise<TenantDto> {
    const tenant = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
    });
    if (!tenant) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Tenant not found',
      });
    }
    return toDto(tenant);
  }

  async updateCurrent(ctx: CallerContext, input: UpdateTenantInput): Promise<TenantDto> {
    const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const patch: Partial<typeof tenants.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.settings !== undefined) patch.settings = input.settings;

      const [row] = await tx
        .update(tenants)
        .set(patch)
        .where(eq(tenants.id, ctx.tenantId))
        .returning();
      return row;
    });
    if (!updated) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Tenant not found',
      });
    }
    return toDto(updated);
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

function toDto(t: typeof tenants.$inferSelect): TenantDto {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    settings: (t.settings as Record<string, unknown>) ?? {},
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  };
}
