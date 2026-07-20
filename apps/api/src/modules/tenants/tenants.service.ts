/**
 * TenantsService — read/update for the caller's own tenant only.
 *
 * Tenant creation lives in AuthService.signup, not here, because creating a
 * tenant has no caller-tenant context yet (chicken/egg). Direct tenant
 * creation by a customer is intentionally not exposed.
 *
 * Settings deep-merge — Admin Settings build 7 of 7.
 *   The Company Profile UI patches small slices of tenants.settings (e.g.
 *   just the business_hours), but settings is a single jsonb column. A
 *   naive set on `settings` would clobber every key not in the payload.
 *   updateCurrent() instead reads the existing settings inside the same
 *   transaction, deep-merges the incoming patch, and writes the merged
 *   result. Top-level keys are replaced; nested objects (e.g.
 *   physical_address) merge one level deep so a partial address update
 *   doesn't drop the zip.
 *
 * First-save validation.
 *   The Zod schema for the Company Profile distinguishes "first save" (no
 *   physical_address yet — the operator is filling in the full form for
 *   the first time) from later partial saves. First save requires every
 *   not-optional field; later saves can be any non-empty subset.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { tenants } from '@ustowdispatch/db';
import {
  ERROR_CODES,
  type TenantDto,
  companyProfileSettingsPartialSchema,
  companyProfileSettingsSchema,
} from '@ustowdispatch/shared';
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
  convinicarVendorId?: string | null | undefined;
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
      const existing = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      if (!existing) return null;

      const patch: Partial<typeof tenants.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.convinicarVendorId !== undefined)
        patch.convinicarVendorId = input.convinicarVendorId;
      if (input.settings !== undefined) {
        const merged = deepMergeSettings(
          (existing.settings as Record<string, unknown> | null) ?? {},
          input.settings,
        );
        // Validate the merged settings shape. The first save (no
        // physical_address in `existing.settings`) must satisfy the full
        // schema — that's how we enforce "all required fields on initial
        // save". Subsequent saves are merging into a tenant that already
        // has the required fields, so the partial-only schema is enough.
        const firstSave = !hasPhysicalAddress(existing.settings);
        const validator = firstSave
          ? companyProfileSettingsSchema
          : companyProfileSettingsPartialSchema;
        const parsed = validator.safeParse(firstSave ? merged : (input.settings as unknown));
        if (!parsed.success) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: firstSave
              ? 'Company profile is missing required fields'
              : 'Company profile patch is invalid',
            details: parsed.error.flatten(),
          });
        }
        patch.settings = merged;
      }

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
    companyCode: t.companyCode,
    name: t.name,
    status: t.status,
    settings: (t.settings as Record<string, unknown>) ?? {},
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
    convinicarVendorId: t.convinicarVendorId,
  };
}

/**
 * Two-level deep merge. Top-level keys in `incoming` replace those in
 * `existing`. For keys whose value is a plain object in BOTH (e.g.
 * physical_address with street_1, city, state, zip), the merge recurses
 * one level. Arrays and primitives always replace — there's no concept
 * of "merge an address by patching just the zip" for arrays.
 */
function deepMergeSettings(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    const prev = existing[k];
    if (isPlainObject(prev) && isPlainObject(v)) {
      out[k] = { ...prev, ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasPhysicalAddress(settings: unknown): boolean {
  if (!isPlainObject(settings)) return false;
  return isPlainObject(settings.physical_address);
}
