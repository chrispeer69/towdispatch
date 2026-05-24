/**
 * Tenant branding contracts (White-Label Customer Portal — Session 32).
 *
 * Drives both the staff branding admin (apps/web settings/branding) and the
 * customer-facing portal's applied look. Runs on client (react-hook-form Zod
 * resolver) and server (NestJS ZodBody) so the rules stay in sync.
 *
 * Colors are 7-char hex (#RRGGBB). custom_domain is the operator's vanity
 * host (portal.acme-towing.com); verification is tracked server-side and
 * surfaced as a read-only status on the DTO.
 */
import { z } from 'zod';

/** #RRGGBB. Empty string is coerced to null upstream (cleared field). */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color, e.g. #144399');

/** A bare hostname like portal.acme-towing.com (no scheme, no path). */
export const customDomainSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'Must be a valid hostname, e.g. portal.acme-towing.com',
  )
  .toLowerCase();

export const brandingDomainStatusValues = ['unset', 'pending', 'verified'] as const;
export type BrandingDomainStatus = (typeof brandingDomainStatusValues)[number];

/** Full read shape returned to the staff branding admin. */
export const tenantBrandingSchema = z.object({
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  accentColor: z.string().nullable(),
  supportEmail: z.string().nullable(),
  supportPhone: z.string().nullable(),
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  customDomain: z.string().nullable(),
  customDomainStatus: z.enum(brandingDomainStatusValues),
  customDomainVerifiedAt: z.string().datetime().nullable(),
  /** <slug>.portal.<PORTAL_BASE_DOMAIN> — always available as a fallback. */
  fallbackDomain: z.string(),
  updatedAt: z.string().datetime().nullable(),
});
export type TenantBrandingDto = z.infer<typeof tenantBrandingSchema>;

/**
 * Upsert payload. Every field optional; an explicitly-null value clears the
 * column, an omitted field leaves it untouched. Colors/domain validated when
 * a non-null value is supplied.
 */
export const updateTenantBrandingSchema = z
  .object({
    primaryColor: hexColorSchema.nullable(),
    accentColor: hexColorSchema.nullable(),
    supportEmail: z.string().email().max(254).nullable(),
    supportPhone: z.string().max(40).nullable(),
    termsUrl: z.string().url().max(2048).nullable(),
    privacyUrl: z.string().url().max(2048).nullable(),
    customDomain: customDomainSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateTenantBrandingPayload = z.infer<typeof updateTenantBrandingSchema>;

/**
 * Logo upload payload. The image bytes ride as base64 in a normal JSON body
 * (logos are small) so we reuse the JSON API + JwtAuthGuard rather than
 * adding multipart handling. Server decodes to a Buffer and hands it to the
 * existing StorageProvider.
 */
export const uploadLogoSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  /** base64 (no data: prefix). Capped ~2.7MB encoded (~2MB raw). */
  dataBase64: z.string().min(1).max(2_800_000),
});
export type UploadLogoPayload = z.infer<typeof uploadLogoSchema>;
