/**
 * Enterprise SSO connection contracts (Session 38). One IdP binding per
 * (tenant, provider). Secrets (x509 private material, OIDC client secret)
 * are NEVER returned in a DTO — only booleans indicating whether they are
 * set. These run on both the NestJS admin controller and the web admin UI.
 */
import { z } from 'zod';

export const ssoProviderValues = ['saml', 'oidc'] as const;
export type SsoProvider = (typeof ssoProviderValues)[number];

export const ssoDefaultRoleValues = [
  'owner',
  'admin',
  'manager',
  'dispatcher',
  'driver',
  'accounting',
  'auditor',
] as const;
export type SsoDefaultRole = (typeof ssoDefaultRoleValues)[number];

/** IdP claim/attribute names mapped onto our user fields. */
export const ssoAttributeMappingSchema = z.object({
  email: z.string().min(1).max(256).optional(),
  firstName: z.string().min(1).max(256).optional(),
  lastName: z.string().min(1).max(256).optional(),
  role: z.string().min(1).max(256).optional(),
});
export type SsoAttributeMapping = z.infer<typeof ssoAttributeMappingSchema>;

/**
 * Connection as returned to the admin UI. No secret material — the SAML
 * x509Cert is the IdP's PUBLIC signing cert (safe to show); oidcClientId is
 * not a secret; the OIDC client secret is surfaced only as
 * `oidcClientSecretSet`.
 */
export const ssoConnectionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  provider: z.enum(ssoProviderValues),
  displayName: z.string(),
  issuer: z.string().nullable(),
  metadataUrl: z.string().nullable(),
  x509Cert: z.string().nullable(),
  ssoUrl: z.string().nullable(),
  sloUrl: z.string().nullable(),
  audience: z.string().nullable(),
  oidcClientId: z.string().nullable(),
  oidcClientSecretSet: z.boolean(),
  oidcScopes: z.string(),
  attributeMapping: ssoAttributeMappingSchema,
  defaultRole: z.enum(ssoDefaultRoleValues),
  enabled: z.boolean(),
  /** Absolute callback URLs the IdP must be configured with. */
  acsUrl: z.string(),
  oidcRedirectUrl: z.string(),
  loginUrl: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type SsoConnectionDto = z.infer<typeof ssoConnectionSchema>;

const baseConnectionFields = {
  displayName: z.string().min(1).max(160),
  issuer: z.string().min(1).max(2048).optional(),
  metadataUrl: z.string().url().max(2048).optional(),
  x509Cert: z.string().min(1).max(16_384).optional(),
  ssoUrl: z.string().url().max(2048).optional(),
  sloUrl: z.string().url().max(2048).optional(),
  audience: z.string().min(1).max(2048).optional(),
  oidcClientId: z.string().min(1).max(512).optional(),
  oidcClientSecret: z.string().min(1).max(2048).optional(),
  oidcScopes: z.string().min(1).max(512).optional(),
  attributeMapping: ssoAttributeMappingSchema.optional(),
  defaultRole: z.enum(ssoDefaultRoleValues).optional(),
  enabled: z.boolean().optional(),
};

export const createSsoConnectionSchema = z
  .object({
    provider: z.enum(ssoProviderValues),
    ...baseConnectionFields,
  })
  .superRefine((v, ctx) => {
    if (v.provider === 'saml') {
      if (!v.x509Cert)
        ctx.addIssue({ code: 'custom', path: ['x509Cert'], message: 'x509Cert required for SAML' });
      if (!v.ssoUrl)
        ctx.addIssue({ code: 'custom', path: ['ssoUrl'], message: 'ssoUrl required for SAML' });
      if (!v.issuer)
        ctx.addIssue({ code: 'custom', path: ['issuer'], message: 'issuer required for SAML' });
    } else {
      if (!v.issuer)
        ctx.addIssue({ code: 'custom', path: ['issuer'], message: 'issuer required for OIDC' });
      if (!v.oidcClientId)
        ctx.addIssue({
          code: 'custom',
          path: ['oidcClientId'],
          message: 'oidcClientId required for OIDC',
        });
    }
  });
export type CreateSsoConnectionPayload = z.infer<typeof createSsoConnectionSchema>;

/** Patch — every field optional; provider is immutable after creation. */
export const updateSsoConnectionSchema = z.object(baseConnectionFields);
export type UpdateSsoConnectionPayload = z.infer<typeof updateSsoConnectionSchema>;
