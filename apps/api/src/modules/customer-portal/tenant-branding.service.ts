/**
 * TenantBrandingService — staff-side white-label admin (Session 32).
 *
 * Backs apps/web settings/branding. Tenant-scoped via RLS (staff JWT →
 * runInTenantContext); one tenant_branding row per tenant, upserted. Logo
 * bytes arrive base64 in JSON and are handed to the existing StorageProvider.
 *
 * Changing the custom domain resets its verification stamp — a new domain
 * must be re-verified (DNS + Railway) before it routes. See
 * CUSTOM_DOMAIN_RUNBOOK.md.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { tenantBranding, tenants } from '@ustowdispatch/db';
import {
  type BrandingDomainStatus,
  ERROR_CODES,
  type TenantBrandingDto,
  type UpdateTenantBrandingPayload,
  type UploadLogoPayload,
} from '@ustowdispatch/shared';
import type { StorageProvider } from '@ustowdispatch/shared';
import { eq } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.module.js';

export interface BrandingCallerCtx {
  tenantId: string;
  userId: string;
  requestId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

@Injectable()
export class TenantBrandingService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async getBranding(ctx: BrandingCallerCtx): Promise<TenantBrandingDto> {
    return this.db.runInTenantContext(this.toCtx(ctx), async (tx) => {
      const tenant = await this.requireTenantSlug(tx, ctx.tenantId);
      const row = await tx.query.tenantBranding.findFirst({
        where: eq(tenantBranding.tenantId, ctx.tenantId),
      });
      return this.toDto(tenant.slug, row);
    });
  }

  async updateBranding(
    ctx: BrandingCallerCtx,
    payload: UpdateTenantBrandingPayload,
  ): Promise<TenantBrandingDto> {
    try {
      return await this.db.runInTenantContext(this.toCtx(ctx), async (tx) => {
        const tenant = await this.requireTenantSlug(tx, ctx.tenantId);
        const existing = await tx.query.tenantBranding.findFirst({
          where: eq(tenantBranding.tenantId, ctx.tenantId),
        });

        // Only touch keys the caller actually sent. An explicit null clears
        // the column; an omitted key is left untouched.
        const patch: Record<string, unknown> = {};
        for (const key of [
          'primaryColor',
          'accentColor',
          'supportEmail',
          'supportPhone',
          'termsUrl',
          'privacyUrl',
          'customDomain',
        ] as const) {
          if (key in payload) patch[key] = payload[key] ?? null;
        }

        // A changed custom domain must be re-verified before it routes.
        if (
          'customDomain' in payload &&
          (payload.customDomain ?? null) !== (existing?.customDomain ?? null)
        ) {
          patch.customDomainVerifiedAt = null;
        }

        if (existing) {
          await tx
            .update(tenantBranding)
            .set({ ...patch, updatedBy: ctx.userId, updatedAt: new Date() })
            .where(eq(tenantBranding.tenantId, ctx.tenantId));
        } else {
          await tx.insert(tenantBranding).values({
            tenantId: ctx.tenantId,
            updatedBy: ctx.userId,
            ...patch,
          });
        }

        const row = await tx.query.tenantBranding.findFirst({
          where: eq(tenantBranding.tenantId, ctx.tenantId),
        });
        return this.toDto(tenant.slug, row);
      });
    } catch (err) {
      // Globally-unique custom domain → 23505 from the partial unique index.
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'That custom domain is already in use by another workspace.',
        });
      }
      throw err;
    }
  }

  async uploadLogo(ctx: BrandingCallerCtx, payload: UploadLogoPayload): Promise<TenantBrandingDto> {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(payload.dataBase64, 'base64');
    } catch {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Logo data is not valid base64.',
      });
    }
    if (bytes.byteLength === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Logo file is empty.',
      });
    }

    const ext = MIME_EXTENSIONS[payload.mimeType] ?? 'bin';
    const stored = await this.storage.put({
      tenantId: ctx.tenantId,
      ownerType: 'tenant_branding',
      ownerId: ctx.tenantId,
      fileName: `logo.${ext}`,
      mimeType: payload.mimeType,
      bytes,
    });
    const logoUrl = this.storage.toUrl(ctx.tenantId, stored.key);

    return this.db.runInTenantContext(this.toCtx(ctx), async (tx) => {
      const tenant = await this.requireTenantSlug(tx, ctx.tenantId);
      const existing = await tx.query.tenantBranding.findFirst({
        where: eq(tenantBranding.tenantId, ctx.tenantId),
      });
      if (existing) {
        await tx
          .update(tenantBranding)
          .set({ logoUrl, updatedBy: ctx.userId, updatedAt: new Date() })
          .where(eq(tenantBranding.tenantId, ctx.tenantId));
      } else {
        await tx
          .insert(tenantBranding)
          .values({ tenantId: ctx.tenantId, logoUrl, updatedBy: ctx.userId });
      }
      const row = await tx.query.tenantBranding.findFirst({
        where: eq(tenantBranding.tenantId, ctx.tenantId),
      });
      return this.toDto(tenant.slug, row);
    });
  }

  // ---------------------------------------------------------------------------
  private async requireTenantSlug(tx: Tx, tenantId: string): Promise<{ slug: string }> {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { slug: true },
    });
    if (!tenant) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Tenant not found' });
    }
    return tenant;
  }

  private toDto(
    slug: string,
    row: typeof tenantBranding.$inferSelect | undefined,
  ): TenantBrandingDto {
    const customDomain = row?.customDomain ?? null;
    const verifiedAt = row?.customDomainVerifiedAt ?? null;
    let status: BrandingDomainStatus = 'unset';
    if (customDomain) status = verifiedAt ? 'verified' : 'pending';
    return {
      logoUrl: row?.logoUrl ?? null,
      primaryColor: row?.primaryColor ?? null,
      accentColor: row?.accentColor ?? null,
      supportEmail: row?.supportEmail ?? null,
      supportPhone: row?.supportPhone ?? null,
      termsUrl: row?.termsUrl ?? null,
      privacyUrl: row?.privacyUrl ?? null,
      customDomain,
      customDomainStatus: status,
      customDomainVerifiedAt: verifiedAt ? verifiedAt.toISOString() : null,
      fallbackDomain: `${slug}.${this.config.portal.baseDomain}`,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  private toCtx(ctx: BrandingCallerCtx): {
    tenantId: string;
    userId: string;
    requestId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}
