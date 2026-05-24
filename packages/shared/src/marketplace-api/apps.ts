/**
 * Public Marketplace API (Session 46) — app (listing) contracts.
 *
 * A marketplace app is GLOBAL (owned by a developer account, not a tenant).
 * Lifecycle: draft → review → listed → suspended. Only `listed` apps appear
 * in the public directory and can be installed. Review is a manual,
 * platform-admin operation in v1 (no auto-approval).
 */
import { z } from 'zod';
import { MARKETPLACE_SCOPES } from './scopes';

export const marketplaceAppStatusValues = ['draft', 'review', 'listed', 'suspended'] as const;
export type MarketplaceAppStatus = (typeof marketplaceAppStatusValues)[number];

export const marketplaceAppCategoryValues = [
  'accounting',
  'analytics',
  'crm',
  'dispatch',
  'fleet',
  'integration',
  'marketing',
  'other',
] as const;
export type MarketplaceAppCategory = (typeof marketplaceAppCategoryValues)[number];

const scopeEnum = z.enum(MARKETPLACE_SCOPES);
const slugSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');
const httpsUrl = z.string().url().startsWith('https://', 'must be an https URL');

/** Full app record visible to the owning developer and platform admins. */
export const marketplaceAppSchema = z.object({
  id: z.string().uuid(),
  developerId: z.string().uuid(),
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  category: z.enum(marketplaceAppCategoryValues),
  logoUrl: httpsUrl.nullable(),
  scopes: z.array(scopeEnum),
  oauthRedirectUrls: z.array(httpsUrl).min(1),
  webhookUrl: httpsUrl.nullable(),
  status: z.enum(marketplaceAppStatusValues),
  reviewNotes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MarketplaceAppDto = z.infer<typeof marketplaceAppSchema>;

/**
 * Public directory view — strips developer-internal fields (redirect URLs,
 * webhook URL, review notes) and never exposes the client secret.
 */
export const marketplaceAppPublicSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  description: z.string(),
  category: z.enum(marketplaceAppCategoryValues),
  logoUrl: httpsUrl.nullable(),
  scopes: z.array(scopeEnum),
  developerName: z.string(),
  createdAt: z.string().datetime(),
});
export type MarketplaceAppPublicDto = z.infer<typeof marketplaceAppPublicSchema>;

export const createMarketplaceAppSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(''),
  category: z.enum(marketplaceAppCategoryValues).default('other'),
  logoUrl: httpsUrl.nullable().default(null),
  scopes: z.array(scopeEnum).min(1),
  oauthRedirectUrls: z.array(httpsUrl).min(1).max(10),
  webhookUrl: httpsUrl.nullable().default(null),
});
export type CreateMarketplaceAppPayload = z.infer<typeof createMarketplaceAppSchema>;

/** Edits are allowed only while an app is draft or listed (not in review). */
export const updateMarketplaceAppSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(4000),
    category: z.enum(marketplaceAppCategoryValues),
    logoUrl: httpsUrl.nullable(),
    scopes: z.array(scopeEnum).min(1),
    oauthRedirectUrls: z.array(httpsUrl).min(1).max(10),
    webhookUrl: httpsUrl.nullable(),
  })
  .partial();
export type UpdateMarketplaceAppPayload = z.infer<typeof updateMarketplaceAppSchema>;

/**
 * Returned once, at creation: the OAuth client_id (the app id) and the
 * client_secret PLAINTEXT. The secret is shown only here — we store a hash.
 */
export const marketplaceAppCredentialsSchema = z.object({
  app: marketplaceAppSchema,
  clientId: z.string().uuid(),
  clientSecret: z.string(),
});
export type MarketplaceAppCredentials = z.infer<typeof marketplaceAppCredentialsSchema>;

export const marketplaceAppMetricsSchema = z.object({
  appId: z.string().uuid(),
  activeInstalls: z.number().int().nonnegative(),
  totalInstalls: z.number().int().nonnegative(),
  totalUninstalls: z.number().int().nonnegative(),
  lastInstalledAt: z.string().datetime().nullable(),
});
export type MarketplaceAppMetrics = z.infer<typeof marketplaceAppMetricsSchema>;

export const directoryQuerySchema = z.object({
  category: z.enum(marketplaceAppCategoryValues).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

export const directoryPageSchema = z.object({
  apps: z.array(marketplaceAppPublicSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type DirectoryPage = z.infer<typeof directoryPageSchema>;

/** Platform-admin review action (v1: manual, token-gated). */
export const reviewActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'suspend']),
  notes: z.string().max(2000).optional(),
});
export type ReviewActionPayload = z.infer<typeof reviewActionSchema>;

/** Platform-admin review-queue filter; defaults to apps awaiting review. */
export const reviewQuerySchema = z.object({
  status: z.enum(marketplaceAppStatusValues).default('review'),
});
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
